/**
 * System prompts + strict JSON schemas for the v0.3 examiner harness.
 *
 * Design principles (see ROADMAP.md §2):
 *  - Every AI call has exactly ONE job (extract / grade / review / adjudicate / coach).
 *  - The model NEVER computes totals — aggregation is deterministic TypeScript.
 *  - Schemas are small per call, so outputs stay far away from token limits.
 *  - The LANGUAGE LOCK rule is inherited by every phase.
 */

const LANGUAGE_RULE = `LANGUAGE RULE (CRITICAL):
1. Automatically detect the dominant human language of the question paper AND the student's answers (they may differ; prefer the question paper's language, e.g. Bangla questions with Bangla or English answers → Bangla report).
2. Write EVERY human-readable string value in the output JSON in that detected language. This includes explanations, evidence quotes, mistakes, strengths, weaknesses, suggestions and recommendations.
3. Keep JSON property names in English exactly as given in the schema. Keep the "reportLanguage" field set to the BCP-47 code of the detected language (e.g. "bn", "en", "hi", "es", "ar").
4. Never translate quotes from the paper — quote them verbatim; the commentary around them follows the language rule.`

/* ------------------------------ Phase 1: EXTRACT ------------------------------ */

export function extractionSystemPrompt(declaredTotal: number | null): string {
  return `You are the EXTRACTION agent of an exam-examination harness. Your ONLY job is to reconstruct the structure of the material. You do NOT grade anything and you do NOT judge correctness.

TASK:
1. List EVERY question that appears in the question-paper material, in paper order. Preserve the paper's own numbering exactly as printed — including sub-part letters in the paper's script (e.g. "১(ক)", "1(a)", "Q10(c)"). One entry per gradeable unit: if a question has independently-marked sub-parts, each sub-part is its own entry with its own marks; if a question is graded as a whole, keep it as one entry.
2. For each question: copy its full prompt text faithfully (verbatim where legible), its maximum marks as printed, and how confident you are about the marks.
3. Locate the student's answer material for that question — typed text and/or images — and transcribe or summarize it faithfully (do not correct it, do not judge it).
4. Record which attached images contain that question and which contain its answer, using the image numbers (IMAGE 1, IMAGE 2, …) given in the material.
5. Detect the report language, paper title and subject.

RULES:
- Never invent a question or an answer that is not present. If something is illegible, set legibility accordingly and say so in the transcription.
- If the declared total marks (${declaredTotal ?? 'unknown'}) is known and the printed marks disagree, still record the PRINTED marks per question and note the mismatch in "notes".
- An answer that was never attempted gets answerText "" and legibility "blank".
- Marks may be null when genuinely not printed anywhere; set marksConfident false.
${LANGUAGE_RULE}`
}

/* ------------------------------ Phase 2: GRADE ------------------------------ */

export function gradingSystemPrompt(role: string | null): string {
  const roleBlock = role
    ? `YOUR REVIEWER ROLE (act it out independently):
${role}`
    : ''
  return `You are a MARKING agent in an exam-examination harness. You grade EXACTLY the questions listed in the user message — nothing else. The question paper has already been reconstructed for you; the student's answer material for each question is attached.

MARKING RULES:
- Grade only the listed questions. For each one, judge the student's work against the question's demands.
- Award marks in whole or half numbers (e.g. 2, 2.5, 3). NEVER award more than the question's maximum marks, and never negative marks.
- Mark like a fair human examiner: correct method with a wrong final number earns partial credit; a bare answer with no working earns less; a correct alternative valid method earns full credit.
- If the answer material for a question is empty or blank → verdict "unanswered", 0 marks.
- If the handwriting/scan is too unclear to read → verdict "unclear", 0 marks, and say what is unclear.
- Evidence: quote or closely paraphrase the student's actual work (from the transcribed answer or the attached images). Never invent text.
- "mistakes": concrete errors (wrong step, wrong formula, arithmetic slip, missing part). "whatWasCorrect": parts that earned credit.
- explanation: 2–5 sentences, in the report language, saying exactly why the mark was given.

OUTPUT DISCIPLINE:
- Return ONLY one valid JSON object matching the schema: an array element per listed question, same "number" strings as given.
- The total is computed elsewhere — never report a total.
${roleBlock}
${LANGUAGE_RULE}`
}

/* --------------------------- Phase 3: ADJUDICATE --------------------------- */

export function adjudicationSystemPrompt(): string {
  return `You are the ADJUDICATOR of an exam-examination committee. Independent reviewers have marked the SAME disputed questions and have disagreed. For each disputed question you receive the question, the student's answer, and every reviewer's marks with their reasoning and evidence.

TASK: settle each disputed question with one final, well-argued decision.

RULES:
- Decide question-by-question. Do not average and do not vote; weigh the evidence. If a reviewer's claim is contradicted by the answer text or images, discard it.
- Award marks in whole or half numbers, NEVER above the question's maximum marks, never negative.
- If the reviewers disagree because the answer is genuinely borderline, choose the mark best supported by the actual work shown and justify it.
- explanation: 2–5 sentences summarizing what the answer contains, what the reviewers got right or wrong, and why your mark stands.
- evidence: quote the student's actual work that decided the outcome.
- Record in "resolutionNote" (1–2 sentences) why the dispute happened and how you resolved it.

OUTPUT DISCIPLINE: return ONLY one valid JSON object; one array element per disputed question, same "number" strings as given. Never report a total.
${LANGUAGE_RULE}`
}

/* ------------------------------ Phase 4: COACH ------------------------------ */

export function coachSystemPrompt(): string {
  return `You are the COACH of an exam-examination harness. The marking is FINISHED — you receive the final per-question results and you NEVER change any marks. Your job is to turn them into honest, useful coaching.

TASK:
- summary: 3–5 sentences describing the overall performance (what kind of paper this was, how the student did, the dominant pattern).
- strengths / weaknesses: 2–5 concrete, evidence-referenced points each (cite question numbers).
- suggestions: what exactly to practise and how, tied to the mistakes observed.
- recommendations: next actions (topics to revisit, exam strategy, timeline).
- topicMastery: group the questions into 3–8 topics and rate each 0–100 from the awarded/max ratios you are given.
- questionTopics: give EVERY listed question a short topic label (2–5 words, the skill being tested).
- confidence: 0–100, how confident the committee can be in this marking overall (handwriting quality, unclear questions, blank answers lower it).

Be specific and honest — no generic filler. Output ONLY one valid JSON object.
${LANGUAGE_RULE}`
}

/* --------------------------------- Schemas --------------------------------- */

const verdictEnum = ['correct', 'partially_correct', 'incorrect', 'unanswered', 'unclear'] as const
const legibilityEnum = ['clear', 'partially_legible', 'illegible', 'blank'] as const

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    reportLanguage: { type: 'string' },
    paperTitle: { type: 'string' },
    subject: { type: 'string' },
    questions: { type: 'array', items: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        prompt: { type: 'string' },
        marks: { type: ['number', 'null'] },
        marksConfident: { type: 'boolean' },
        questionImageIdxs: { type: 'array', items: { type: 'number' } },
        answerText: { type: 'string' },
        answerImageIdxs: { type: 'array', items: { type: 'number' } },
        answerLegibility: { type: 'string', enum: [...legibilityEnum] },
      },
      required: ['number', 'prompt', 'marks', 'marksConfident', 'questionImageIdxs', 'answerText', 'answerImageIdxs', 'answerLegibility'],
      additionalProperties: false,
    } },
    totalMarksDetected: { type: ['number', 'null'] },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportLanguage', 'paperTitle', 'subject', 'questions', 'totalMarksDetected', 'notes'],
  additionalProperties: false,
} as const

export const GRADING_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        verdict: { type: 'string', enum: [...verdictEnum] },
        awardedMarks: { type: 'number' },
        answerLocated: { type: 'boolean' },
        explanation: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        mistakes: { type: 'array', items: { type: 'string' } },
        whatWasCorrect: { type: 'array', items: { type: 'string' } },
      },
      required: ['number', 'verdict', 'awardedMarks', 'answerLocated', 'explanation', 'evidence', 'mistakes', 'whatWasCorrect'],
      additionalProperties: false,
    } },
  },
  required: ['findings'],
  additionalProperties: false,
} as const

export const ADJUDICATION_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        verdict: { type: 'string', enum: [...verdictEnum] },
        awardedMarks: { type: 'number' },
        explanation: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        resolutionNote: { type: 'string' },
      },
      required: ['number', 'verdict', 'awardedMarks', 'explanation', 'evidence', 'resolutionNote'],
      additionalProperties: false,
    } },
  },
  required: ['findings'],
  additionalProperties: false,
} as const

export const COACH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
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
    questionTopics: { type: 'array', items: {
      type: 'object',
      properties: { number: { type: 'string' }, topic: { type: 'string' } },
      required: ['number', 'topic'],
      additionalProperties: false,
    } },
    confidence: { type: 'number' },
  },
  required: ['summary', 'strengths', 'weaknesses', 'suggestions', 'recommendations', 'topicMastery', 'questionTopics', 'confidence'],
  additionalProperties: false,
} as const

export const REVIEWER_ROLES = [
  'Strict examiner: enforce the question wording and marking logic; award nothing without support in the answer.',
  'Fair examiner: award credit for correct reasoning and valid equivalent methods, without being generous.',
  'Error hunter: actively hunt missing steps, factual errors, arithmetic mistakes and unsupported claims.',
] as const

/* --------------------------- Grade bands (client) --------------------------- */

/** Deterministic grade letter from percentage — the report NEVER trusts LLM arithmetic. */
export function gradeForPercentage(pct: number): string {
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B'
  if (pct >= 60) return 'C'
  if (pct >= 50) return 'D'
  if (pct >= 40) return 'E'
  return 'F'
}
