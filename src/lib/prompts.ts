/**
 * System prompts + strict JSON schemas for the examination pipeline.
 * Every prompt carries the LANGUAGE LOCK rule: the report language is auto-detected
 * from the question paper + answers, independent of the app's UI language.
 */

const LANGUAGE_RULE = `LANGUAGE RULE (CRITICAL):
1. Automatically detect the dominant human language of the question paper AND the student's answers (they may differ; prefer the question paper's language, e.g. Bangla questions with Bangla or English answers → Bangla report).
2. Write EVERY human-readable string value in the output JSON in that detected language. This includes summaries, explanations, strengths, weaknesses, suggestions, recommendations and evidence quotes.
3. Keep JSON property names in English exactly as given in the schema. Keep the "reportLanguage" field set to the BCP-47 code of the detected language (e.g. "bn", "en", "hi", "es", "ar").
4. Never translate quotes from the paper — quote them verbatim; the commentary around them follows the language rule.`

const GENERAL_RULES = `GENERAL EXAMINER RULES:
- You are examining an exam paper: reconstruct the questions, then grade the student's submitted answers against them like a real examiner.
- Award marks question-by-question. Never exceed a question's maximum marks. If a maximum is unknown, infer the most reasonable allocation and explain it.
- Support every verdict with concrete evidence quoted or paraphrased from the paper. Do not invent content that is not in the material.
- Handle edge cases gracefully: blank answers, illegible handwriting (mark as "unclear"), off-topic content, mixed languages, extra pages, out-of-order pages.
- Be fair and consistent: correct reasoning earns credit even if the final answer is wrong; unsupported claims do not.
- Return ONLY one valid JSON object matching the given schema. No markdown fences, no commentary before or after.`

export function singleModeSystemPrompt(): string {
  return `You are Paper Examiner's single-agent examiner: a senior exam examiner for ANY subject, ANY country, ANY level.
${LANGUAGE_RULE}

${GENERAL_RULES}
- In one pass: identify every question and its maximum marks from the question paper, locate the student's corresponding answer, and grade it.`
}

export function reconstructionSystemPrompt(): string {
  return `You are the reconstruction agent in Paper Examiner's multi-agent pipeline.
Reconstruct the complete question paper and the student's submitted solutions from raw mixed material (photos may be out of order, typed text may be interleaved).
Do NOT grade anything in this stage. Preserve wording faithfully. Infer question boundaries, numbering, sub-parts and visible marks. Match answer material to question numbers when possible. Never invent missing text — record uncertainty in "notes".
${LANGUAGE_RULE}

${GENERAL_RULES}`
}

export function reviewerSystemPrompt(role: string): string {
  return `You are an independent exam reviewer in Paper Examiner's multi-agent pipeline. Several reviewers work in parallel; you MUST reason independently and never assume what they concluded.
YOUR ROLE: ${role}
Evaluate the student's answers against the reconstructed questions. Award marks conservatively, never exceeding a question's maximum. Use evidence from the supplied material. Do not average or vote.
${LANGUAGE_RULE}

${GENERAL_RULES}`
}

export function adjudicatorSystemPrompt(): string {
  return `You are the MAIN ADJUDICATOR of Paper Examiner's multi-agent pipeline.
CRITICAL: Do NOT average reviewer scores and do not vote. Reconcile their reports by examining the reconstructed questions, the student's answers, each review's evidence and the maximum marks. Prefer conclusions backed by concrete evidence. When reviewers disagree, resolve it question-by-question and record the resolution.
You also produce the final coaching sections: strengths, weaknesses, suggestions (what to practise and how) and recommendations (next actions, topics to revisit, study strategy). Also rate mastery (0-100) per topic.
${LANGUAGE_RULE}

${GENERAL_RULES}`
}

/* --------------------------------- Schemas --------------------------------- */

const verdictEnum = ['correct', 'partially_correct', 'incorrect', 'unanswered', 'unclear'] as const

export const SINGLE_SCHEMA = {
  type: 'object',
  properties: {
    reportLanguage: { type: 'string' },
    paperTitle: { type: 'string' },
    subject: { type: 'string' },
    totalMarks: { type: 'number' },
    obtainedMarks: { type: 'number' },
    grade: { type: 'string' },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    questions: { type: 'array', items: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        topic: { type: 'string' },
        prompt: { type: 'string' },
        maxMarks: { type: 'number' },
        verdict: { type: 'string', enum: [...verdictEnum] },
        awardedMarks: { type: 'number' },
        explanation: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        mistakes: { type: 'array', items: { type: 'string' } },
        whatWasCorrect: { type: 'array', items: { type: 'string' } },
      },
      required: ['number', 'topic', 'prompt', 'maxMarks', 'verdict', 'awardedMarks', 'explanation', 'evidence', 'mistakes', 'whatWasCorrect'],
      additionalProperties: false,
    } },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    topicMastery: { type: 'array', items: {
      type: 'object',
      properties: { topic: { type: 'string' }, score: { type: 'number' } },
      required: ['topic', 'score'],
      additionalProperties: false,
    } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportLanguage', 'paperTitle', 'subject', 'totalMarks', 'obtainedMarks', 'grade', 'confidence', 'summary', 'questions', 'strengths', 'weaknesses', 'suggestions', 'recommendations', 'topicMastery', 'notes'],
  additionalProperties: false,
} as const

export const RECONSTRUCTION_SCHEMA = {
  type: 'object',
  properties: {
    reportLanguage: { type: 'string' },
    questions: { type: 'array', items: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        prompt: { type: 'string' },
        marks: { type: ['number', 'null'] },
        parts: { type: 'array', items: { type: 'string' } },
      },
      required: ['number', 'prompt', 'marks', 'parts'],
      additionalProperties: false,
    } },
    answers: { type: 'array', items: {
      type: 'object',
      properties: {
        questionNumber: { type: 'string' },
        answer: { type: 'string' },
      },
      required: ['questionNumber', 'answer'],
      additionalProperties: false,
    } },
    totalMarksDetected: { type: ['number', 'null'] },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportLanguage', 'questions', 'answers', 'totalMarksDetected', 'notes'],
  additionalProperties: false,
} as const

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    proposedTotalMarks: { type: 'number' },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object',
      properties: {
        questionNumber: { type: 'string' },
        verdict: { type: 'string', enum: [...verdictEnum] },
        awardedMarks: { type: 'number' },
        maxMarks: { type: ['number', 'null'] },
        reasoning: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        missingOrWrong: { type: 'array', items: { type: 'string' } },
      },
      required: ['questionNumber', 'verdict', 'awardedMarks', 'maxMarks', 'reasoning', 'evidence', 'missingOrWrong'],
      additionalProperties: false,
    } },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
  },
  required: ['proposedTotalMarks', 'confidence', 'summary', 'findings', 'strengths', 'weaknesses'],
  additionalProperties: false,
} as const

export const ADJUDICATION_SCHEMA = {
  type: 'object',
  properties: {
    reportLanguage: { type: 'string' },
    obtainedMarks: { type: 'number' },
    totalMarks: { type: 'number' },
    grade: { type: 'string' },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    questionResults: { type: 'array', items: {
      type: 'object',
      properties: {
        questionNumber: { type: 'string' },
        topic: { type: 'string' },
        awardedMarks: { type: 'number' },
        maxMarks: { type: ['number', 'null'] },
        verdict: { type: 'string', enum: [...verdictEnum] },
        explanation: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['questionNumber', 'topic', 'awardedMarks', 'maxMarks', 'verdict', 'explanation', 'evidence'],
      additionalProperties: false,
    } },
    strongPoints: { type: 'array', items: { type: 'string' } },
    weakPoints: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    topicMastery: { type: 'array', items: {
      type: 'object',
      properties: { topic: { type: 'string' }, score: { type: 'number' } },
      required: ['topic', 'score'],
      additionalProperties: false,
    } },
    reviewerDisagreements: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportLanguage', 'obtainedMarks', 'totalMarks', 'grade', 'confidence', 'summary', 'questionResults', 'strongPoints', 'weakPoints', 'suggestions', 'recommendations', 'topicMastery', 'reviewerDisagreements'],
  additionalProperties: false,
} as const

export const REVIEWER_ROLES = [
  'Strict examiner: enforce the question wording, marking-scheme logic and maximum marks. Award nothing without support.',
  'Fair examiner: award credit for correct reasoning and valid equivalent methods, without being generous.',
  'Error hunter: actively hunt missing steps, factual errors, arithmetic mistakes, unsupported claims and over-crediting.',
] as const
