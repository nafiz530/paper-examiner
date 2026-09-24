import type { ModelRef } from './settings'
import { withKeyRotation } from './keyPool'
import { AIError, toAIError } from './aiErrors'
import { callModelText, type ImagePart } from './providers'
import { TokenLedger, type TokenPhase, type UsageSummary } from './tokens'
import { HARNESS } from '../config/examiner.config'
import {
  ADJUDICATION_SCHEMA, COACH_SCHEMA, EXTRACTION_SCHEMA, GRADING_SCHEMA,
  REVIEWER_ROLES, adjudicationSystemPrompt, coachSystemPrompt,
  extractionSystemPrompt, gradeForPercentage, gradingSystemPrompt,
} from './prompts'

/* --------------------------------- Types --------------------------------- */

export type PipelineStage = 'preparing' | 'extracting' | 'grading' | 'reviewing' | 'adjudicating' | 'coaching' | 'finishing'

export type ModelState = 'pending' | 'running' | 'done' | 'error'

export type ModelProgress = {
  key: string
  label: string
  model: string
  state: ModelState
  detail?: string
}

export type QuestionChip = {
  number: string
  awarded: number
  max: number | null
  verdict: string
}

export type ProgressEvent = {
  stage: PipelineStage
  detail?: string
  models?: ModelProgress[]
  /** per-question chips as they land (cumulative) */
  questionResults?: QuestionChip[]
  /** live token consumption */
  tokens?: { promptTokens: number; completionTokens: number; totalTokens: number; calls: number; estimated: boolean }
  /** question marking progress */
  counts?: { done: number; total: number }
}

export type Legibility = 'clear' | 'partially_legible' | 'illegible' | 'blank'

export type ExtractedQuestion = {
  number: string
  prompt: string
  marks: number | null
  marksConfident: boolean
  questionImageIdxs: number[]
  answerText: string
  answerImageIdxs: number[]
  answerLegibility: Legibility
}

export type Extraction = {
  reportLanguage: string
  paperTitle: string
  subject: string
  questions: ExtractedQuestion[]
  totalMarksDetected: number | null
  notes: string[]
}

export type GradedFinding = {
  number: string
  verdict: string
  awardedMarks: number
  answerLocated: boolean
  explanation: string
  evidence: string[]
  mistakes: string[]
  whatWasCorrect: string[]
  /** adjudication only: how a reviewer dispute was settled */
  resolutionNote?: string
}

export type QuestionResult = {
  number: string
  topic: string
  maxMarks: number | null
  verdict: string
  awardedMarks: number
  explanation: string
  evidence: string[]
  mistakes: string[]
  whatWasCorrect: string[]
  adjusted: boolean
  dispute?: string
}

export type ReviewerBlock = {
  model: string
  providerLabel: string
  role: string
  findings: Map<string, GradedFinding> // keyed by question number
}

export type UnifiedReport = {
  reportLanguage: string
  mode: 'single' | 'agent'
  paperTitle: string
  subject: string
  totalMarks: number
  obtainedMarks: number
  percentage: number
  grade: string
  confidence: number
  summary: string
  questions: QuestionResult[]
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  recommendations: string[]
  topicMastery: Array<{ topic: string; score: number }>
  notes: string[]
  reviewerSummaries: Array<{ model: string; proposedTotalMarks: number; summary: string }>
  disagreements: string[]
  usedModels: string[]
  usage?: UsageSummary
  timing?: { startedAt: number; finishedAt: number; durationMs: number }
}

/* ------------------------------ JSON extraction ------------------------------ */

export function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* fall through to brace scan */ }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) // throws BAD_JSON-worthy SyntaxError
    if (parsed && typeof parsed === 'object') return parsed
  }
  throw new AIError('BAD_JSON', 'errors.badJson')
}

/* --------------------------------- AI helper --------------------------------- */

/** Shared-tier models are called through our own proxy; BYOK models go straight to the provider. */
export function proxyTarget(model: ModelRef): { providerId: string } | undefined {
  return model.source === 'admin' ? { providerId: model.providerId } : undefined
}

export function modelRefKey(m: ModelRef): string {
  return `${m.source}:${m.providerId}:${m.model}`
}

async function callJSON(
  model: ModelRef,
  opts: { system: string; user: string; images: ImagePart[]; schema: Record<string, unknown>; schemaName: string; maxTokens: number },
  ledger: TokenLedger,
  phase: TokenPhase,
  detail?: string,
): Promise<Record<string, unknown>> {
  const run = async (extraReminder: boolean) => {
    const out = await withKeyRotation(model, (apiKey) => callModelText({
      type: model.type,
      baseURL: model.baseURL,
      model: model.model,
      apiKey,
      proxy: proxyTarget(model),
      system: opts.system,
      user: extraReminder
        ? `${opts.user}\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONLY one valid JSON object matching the schema. No markdown, no commentary.`
        : opts.user,
      images: opts.images,
      schema: opts.schema,
      schemaName: opts.schemaName,
      maxTokens: opts.maxTokens,
    }))
    if (out.usage) ledger.add(phase, model, model.providerLabel, out.usage, extraReminder ? `${detail ?? ''} (repair)`.trim() : detail)
    return out.text
  }
  try {
    return extractJson(await run(false))
  } catch {
    // one repair attempt with a stricter reminder
    return extractJson(await run(true))
  }
}

/* -------------------------------- Utilities -------------------------------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
}

function objArr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v.filter((x) => !!x && typeof x === 'object') as Array<Record<string, unknown>>) : []
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Median of marks, rounded to the nearest half mark (whole/half marks only). */
function medianMark(marks: number[]): number {
  if (marks.length === 0) return 0
  const sorted = [...marks].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(med * 2) / 2
}

/* ------------------------------ Image routing ------------------------------ */

/**
 * Pick the images a set of questions live on (1-based idxs into `all`), preserving order.
 * Falls back to ALL images when the routing map is empty or unusable.
 */
export function pickImages(questions: ExtractedQuestion[], all: ImagePart[]): { images: ImagePart[]; mapping: Map<number, number> } {
  const wanted = new Set<number>()
  for (const q of questions) {
    for (const idx of [...q.questionImageIdxs, ...q.answerImageIdxs]) {
      const i = Math.round(idx) - 1
      if (i >= 0 && i < all.length) wanted.add(i)
    }
  }
  if (wanted.size === 0) {
    const mapping = new Map<number, number>()
    all.forEach((_, i) => mapping.set(i + 1, i + 1))
    return { images: all, mapping }
  }
  const idxs = [...wanted].sort((a, b) => a - b)
  const images = idxs.map((i) => all[i])
  const mapping = new Map<number, number>()
  idxs.forEach((original, position) => mapping.set(original + 1, position + 1))
  return { images, mapping }
}

function imageListText(mapping: Map<number, number>, all: ImagePart[]): string {
  if (all.length === 0) return 'No images are attached to this request (all material is text).'
  if (mapping.size === all.length) return 'All images are attached to this request in the order IMAGE 1 … IMAGE ' + all.length + '.'
  const parts = [...mapping.entries()].map(([original, attached]) => `IMAGE ${attached} (of this request) = original material IMAGE ${original}`)
  return `This request attaches only the images these questions live on:\n${parts.join('\n')}`
}

/* ------------------------- Phase 1: EXTRACTION ------------------------- */

function normalizeExtraction(raw: Record<string, unknown>): Extraction {
  const questions: ExtractedQuestion[] = objArr(raw.questions).map((q) => {
    const leg = typeof q.answerLegibility === 'string' ? q.answerLegibility : 'clear'
    const idxArr = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)).filter((x) => x > 0) : [])
    return {
      number: String(q.number ?? '').trim(),
      prompt: String(q.prompt ?? '').trim(),
      marks: typeof q.marks === 'number' && Number.isFinite(q.marks) && q.marks >= 0 ? q.marks : null,
      marksConfident: q.marksConfident !== false,
      questionImageIdxs: idxArr(q.questionImageIdxs),
      answerText: String(q.answerText ?? '').trim(),
      answerImageIdxs: idxArr(q.answerImageIdxs),
      answerLegibility: (['clear', 'partially_legible', 'illegible', 'blank'] as const).includes(leg as Legibility) ? (leg as Legibility) : 'clear',
    }
  }).filter((q) => q.number.length > 0 || q.prompt.length > 0)
  // guarantee unique, non-empty display numbers
  const seen = new Map<string, number>()
  for (const q of questions) {
    if (!q.number) q.number = '—'
    const n = seen.get(q.number) ?? 0
    seen.set(q.number, n + 1)
    if (n > 0) q.number = `${q.number} (${n + 1})`
  }
  return {
    reportLanguage: typeof raw.reportLanguage === 'string' ? raw.reportLanguage : 'en',
    paperTitle: String(raw.paperTitle ?? ''),
    subject: String(raw.subject ?? ''),
    questions,
    totalMarksDetected: typeof raw.totalMarksDetected === 'number' && Number.isFinite(raw.totalMarksDetected) ? raw.totalMarksDetected : null,
    notes: strArr(raw.notes),
  }
}

export async function runExtraction(
  primary: ModelRef,
  material: string,
  images: ImagePart[],
  declaredTotal: number | null,
  ledger: TokenLedger,
  onProgress: (e: ProgressEvent) => void,
): Promise<Extraction> {
  const key = modelRefKey(primary)
  const mk = (state: ModelState, detail?: string): ModelProgress[] => [{ key, label: primary.providerLabel, model: primary.model, state, detail }]

  onProgress({ stage: 'extracting', models: mk('running'), tokens: ledgerLive(ledger) })
  let raw: Record<string, unknown>
  try {
    raw = await callJSON(primary, {
      system: extractionSystemPrompt(declaredTotal),
      user: `Extract the question paper structure and the student's answers from the material below.\n\n${material}`,
      images,
      schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'paper_examiner_extraction',
      maxTokens: 8000,
    }, ledger, 'extract')
  } catch (e) {
    throw toAIError(e)
  }

  let extraction = normalizeExtraction(raw)

  // Graceless output → one stricter retry before giving up.
  if (extraction.questions.length === 0) {
    onProgress({ stage: 'extracting', detail: 'retry', models: mk('running', 'retry'), tokens: ledgerLive(ledger) })
    raw = await callJSON(primary, {
      system: extractionSystemPrompt(declaredTotal),
      user: `Your previous reply contained ZERO questions. That is wrong — the material contains at least one exam question. Re-read every attached image and text item and list EVERY question you can find, in paper order.\n\n${material}`,
      images,
      schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'paper_examiner_extraction',
      maxTokens: 8000,
    }, ledger, 'extract', 'retry')
    extraction = normalizeExtraction(raw)
    if (extraction.questions.length === 0) {
      throw new AIError('UNREADABLE', 'errors.noQuestions', { detail: 'Extraction found no questions in the supplied material.' })
    }
  }

  // Marks sanity: if the paper declares a total and the extracted marks disagree, note it (never silently rewrite).
  if (declaredTotal != null && declaredTotal > 0) {
    const known = extraction.questions.filter((q) => q.marks != null)
    if (known.length === extraction.questions.length) {
      const sum = round2(known.reduce((s, q) => s + (q.marks ?? 0), 0))
      if (sum !== declaredTotal) {
        extraction.notes.push(`Printed question marks sum to ${sum} but the paper declares ${declaredTotal} in total. The per-question printed marks were kept; the declared total is used for the report.`)
      }
    }
  }
  onProgress({ stage: 'extracting', models: mk('done'), counts: { done: 0, total: extraction.questions.length }, tokens: ledgerLive(ledger) })
  return extraction
}

function ledgerLive(ledger: TokenLedger): ProgressEvent['tokens'] {
  const l = ledger.live()
  return { promptTokens: l.promptTokens, completionTokens: l.completionTokens, totalTokens: l.totalTokens, calls: l.calls, estimated: l.estimated }
}

/* ------------------------- Phase 2: GRADING calls ------------------------- */

function gradingUserPrompt(batch: ExtractedQuestion[], mapping: Map<number, number>, allImages: ImagePart[]): string {
  const blocks = batch.map((q, i) => {
    const refIdxs = [...q.questionImageIdxs, ...q.answerImageIdxs]
    const refs = refIdxs.length
      ? refIdxs.map((orig) => `IMAGE ${mapping.get(Math.round(orig)) ?? orig}`).join(', ')
      : 'see the attached images'
    return `QUESTION ${i + 1} of this batch:
NUMBER: ${q.number}
FULL QUESTION: ${q.prompt || '(see attached images)'}
MAX MARKS: ${q.marks != null ? String(q.marks) : 'not printed — infer the most reasonable small allocation from the question\u2019s demands and state it in your explanation'}
STUDENT ANSWER (transcribed): ${q.answerText || '(no transcription — read it from the images)'}
ANSWER LEGIBILITY: ${q.answerLegibility}
QUESTION/ANSWER APPEARS IN: ${refs}`
  })
  return `GRADE THESE ${batch.length} QUESTIONS — and only these. The paper has already been reconstructed; the answer material for each question is supplied here and in the attached images.

${blocks.join('\n\n')}

${imageListText(mapping, allImages)}

Mark every listed question. Return one findings array element per listed question, using the same NUMBER strings exactly.`
}

function normalizeFindings(raw: Record<string, unknown>, batch: ExtractedQuestion[]): GradedFinding[] {
  const arr = objArr(raw.findings ?? raw.questions)
  const out: GradedFinding[] = []
  const used = new Set<string>()
  for (const f of arr) {
    const number = String(f.number ?? '').trim()
    const q = batch.find((b) => b.number === number && !used.has(b.number))
      ?? batch.find((b) => !used.has(b.number)) // positional fallback when the model echoes numbers imperfectly
    if (!q) continue
    used.add(q.number)
    const verdict = typeof f.verdict === 'string' ? f.verdict : 'unclear'
    out.push({
      number: q.number,
      verdict: (['correct', 'partially_correct', 'incorrect', 'unanswered', 'unclear'] as const).includes(verdict as never) ? verdict : 'unclear',
      awardedMarks: Math.max(0, num(f.awardedMarks ?? f.awarded, 0)),
      answerLocated: f.answerLocated !== false,
      explanation: String(f.explanation ?? f.reasoning ?? '').trim(),
      evidence: strArr(f.evidence),
      mistakes: strArr(f.mistakes),
      whatWasCorrect: strArr(f.whatWasCorrect),
      resolutionNote: typeof f.resolutionNote === 'string' ? f.resolutionNote.trim() : undefined,
    })
  }
  return out
}

/**
 * Grade a set of questions with one model, in batches, in parallel.
 * Failed batches degrade to 'unclear' 0-mark findings instead of failing the whole run.
 */
async function gradeWithModel(
  model: ModelRef,
  role: string | null,
  questions: ExtractedQuestion[],
  allImages: ImagePart[],
  batchSize: number,
  phase: TokenPhase,
  ledger: TokenLedger,
  onEachBatch: (findings: GradedFinding[], batchIndex: number, batchCount: number) => void,
  onTokens: () => void,
): Promise<{ findings: Map<string, GradedFinding>; failedBatches: string[] }> {
  const batches = chunk(questions, batchSize)
  const findings = new Map<string, GradedFinding>()
  const failedBatches: string[] = []
  await Promise.all(batches.map(async (batch, i) => {
    if (i > 0) await sleep(HARNESS.staggerMs * i) // small stagger to be gentle on rate limits
    const { images, mapping } = pickImages(batch, allImages)
    try {
      const raw = await callJSON(model, {
        system: gradingSystemPrompt(role),
        user: gradingUserPrompt(batch, mapping, allImages),
        images,
        schema: GRADING_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'paper_examiner_grading',
        maxTokens: 6500,
      }, ledger, phase, role ? `batch ${i + 1}/${batches.length}` : undefined)
      const found = normalizeFindings(raw, batch)
      for (const f of found) findings.set(f.number, f)
      // coverage inside the batch: un-graded questions become 'unclear' 0 with a note
      for (const q of batch) {
        if (!findings.has(q.number)) {
          findings.set(q.number, {
            number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
            explanation: 'The marking model did not return a result for this question.', evidence: [], mistakes: [], whatWasCorrect: [],
          })
        }
      }
      onEachBatch(found, i, batches.length)
    } catch {
      const label = batch.map((q) => q.number).join(', ')
      failedBatches.push(label)
      for (const q of batch) {
        findings.set(q.number, {
          number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
          explanation: 'This marking call failed (network or provider error) — marked 0. Re-run the examination for a complete result.',
          evidence: [], mistakes: [], whatWasCorrect: [],
        })
      }
      onEachBatch(batch.map((q) => ({
        number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
        explanation: '', evidence: [], mistakes: [], whatWasCorrect: [],
      })), i, batches.length)
    }
    onTokens()
  }))
  return { findings, failedBatches }
}

/* ------------------------- Phase 3: ADJUDICATION ------------------------- */

function adjudicationUserPrompt(
  disputed: Array<{ question: ExtractedQuestion; votes: Array<{ reviewer: string; model: string; finding: GradedFinding }> }>,
  mapping: Map<number, number>,
  allImages: ImagePart[],
): string {
  const blocks = disputed.map((d, i) => {
    const q = d.question
    const refIdxs = [...q.questionImageIdxs, ...q.answerImageIdxs]
    const refs = refIdxs.length ? refIdxs.map((orig) => `IMAGE ${mapping.get(Math.round(orig)) ?? orig}`).join(', ') : 'see the attached images'
    const votes = d.votes.map((v, j) => `REVIEWER ${j + 1} (${v.reviewer}, model ${v.model}): verdict ${v.finding.verdict}, ${v.finding.awardedMarks} mark(s) — ${v.finding.explanation || '(no reasoning given)'}${v.finding.evidence.length ? ` Evidence: ${v.finding.evidence.join(' | ')}` : ''}`).join('\n')
    return `DISPUTED QUESTION ${i + 1}:
NUMBER: ${q.number}
FULL QUESTION: ${q.prompt || '(see attached images)'}
MAX MARKS: ${q.marks != null ? String(q.marks) : 'not printed'}
STUDENT ANSWER (transcribed): ${q.answerText || '(read it from the images)'}
ANSWER LEGIBILITY: ${q.answerLegibility}
QUESTION/ANSWER APPEARS IN: ${refs}

REVIEWER VOTES:
${votes}`
  })
  return `The independent reviewers disagreed on the ${disputed.length} question(s) below. Settle each one with a final decision — weigh the evidence, do not average, do not vote.\n\n${blocks.join('\n\n')}\n\n${imageListText(mapping, allImages)}\n\nReturn one findings element per disputed question, using the same NUMBER strings.`
}

/* ------------------------- Phase 5: DETERMINISTIC AGGREGATION ------------------------- */

function clampFinding(f: GradedFinding, q: ExtractedQuestion): { finding: GradedFinding; adjusted: boolean } {
  let adjusted = false
  let awarded = f.awardedMarks
  let verdict = f.verdict
  if (q.marks != null && awarded > q.marks) { awarded = q.marks; adjusted = true }
  if (awarded < 0) { awarded = 0; adjusted = true }
  if (verdict === 'unanswered' && awarded !== 0) { awarded = 0; adjusted = true }
  if (verdict === 'correct' && q.marks != null && awarded !== q.marks) { awarded = q.marks; adjusted = true }
  if (verdict === 'incorrect' && q.marks != null && awarded === q.marks && q.marks > 0) { verdict = 'partially_correct'; adjusted = true }
  return { finding: { ...f, awardedMarks: awarded, verdict }, adjusted }
}

export function buildReport(opts: {
  mode: 'single' | 'agent'
  extraction: Extraction
  finalFindings: Map<string, GradedFinding>
  disputeNotes: Map<string, string>
  coach: { summary: string; strengths: string[]; weaknesses: string[]; suggestions: string[]; recommendations: string[]; topicMastery: Array<{ topic: string; score: number }>; questionTopics: Map<string, string>; confidence: number }
  reviewers: ReviewerBlock[]
  models: ModelRef[]
  declaredTotal: number | null
  ledger: TokenLedger
  startedAt: number
}): UnifiedReport {
  const { extraction, finalFindings, disputeNotes, coach, reviewers, models, declaredTotal, ledger, startedAt } = opts
  const notes: string[] = [...extraction.notes]

  const questions: QuestionResult[] = extraction.questions.map((q) => {
    const raw = finalFindings.get(q.number)
    const fallback: GradedFinding = {
      number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
      explanation: 'No marking result was produced for this question — marked 0. Re-run the examination.',
      evidence: [], mistakes: [], whatWasCorrect: [],
    }
    const { finding, adjusted } = clampFinding(raw ?? fallback, q)
    return {
      number: q.number,
      topic: coach.questionTopics.get(q.number) ?? '',
      maxMarks: q.marks,
      verdict: finding.verdict,
      awardedMarks: round2(finding.awardedMarks),
      explanation: finding.explanation,
      evidence: finding.evidence,
      mistakes: finding.mistakes,
      whatWasCorrect: finding.whatWasCorrect,
      adjusted,
      dispute: disputeNotes.get(q.number),
    }
  })

  // ── Deterministic totals: the header ALWAYS equals the sum of the breakdown. ──
  const obtained = round2(questions.reduce((s, q) => s + q.awardedMarks, 0))
  const sumMax = questions.reduce((s, q) => s + (q.maxMarks ?? 0), 0)
  const allMarksKnown = questions.every((q) => q.maxMarks != null)
  let total: number
  if (declaredTotal != null && declaredTotal > 0) {
    total = declaredTotal
    if (allMarksKnown && sumMax !== declaredTotal) {
      notes.push(`Per-question marks sum to ${sumMax}; the declared total ${declaredTotal} is shown as the paper total.`)
    }
  } else if (allMarksKnown && sumMax > 0) {
    total = sumMax
  } else {
    total = Math.max(1, extraction.totalMarksDetected ?? sumMax)
    notes.push('Some questions have no printed maximum marks — the total is inferred.')
  }
  // obtained can never exceed total in the report
  const obtainedCapped = Math.min(obtained, total)
  if (obtainedCapped !== obtained) notes.push(`Awarded marks were capped to the paper total (${obtained} → ${obtainedCapped}).`)
  const percentage = total > 0 ? round2((obtainedCapped / total) * 100) : 0

  const adjustedCount = questions.filter((q) => q.adjusted).length
  if (adjustedCount > 0) notes.push(`${adjustedCount} question result(s) were automatically corrected for mark-cap or verdict consistency.`)

  const reviewerSummaries = reviewers.map((r) => {
    const totalFor = extraction.questions.reduce((s, q) => {
      const f = r.findings.get(q.number)
      if (!f) return s
      const cap = q.marks != null ? Math.min(f.awardedMarks, q.marks) : f.awardedMarks
      return s + Math.max(0, cap)
    }, 0)
    const counts = { correct: 0, partially_correct: 0, incorrect: 0, unanswered: 0, unclear: 0 } as Record<string, number>
    for (const q of extraction.questions) {
      const f = r.findings.get(q.number)
      if (f && counts[f.verdict] != null) counts[f.verdict] += 1
    }
    const summary = `✓ ${counts.correct} · ◐ ${counts.partially_correct} · ✗ ${counts.incorrect} · — ${counts.unanswered} · ? ${counts.unclear}`
    return { model: `${r.providerLabel} · ${r.model}`, proposedTotalMarks: round2(totalFor), summary }
  })

  const finishedAt = Date.now()
  return {
    reportLanguage: extraction.reportLanguage,
    mode: opts.mode,
    paperTitle: extraction.paperTitle,
    subject: extraction.subject,
    totalMarks: round2(total),
    obtainedMarks: obtainedCapped,
    percentage,
    grade: gradeForPercentage(percentage),
    confidence: Math.max(0, Math.min(100, Math.round(coach.confidence))),
    summary: coach.summary,
    questions,
    strengths: coach.strengths,
    weaknesses: coach.weaknesses,
    suggestions: coach.suggestions,
    recommendations: coach.recommendations,
    topicMastery: coach.topicMastery.map((t) => ({ topic: String(t.topic ?? ''), score: Math.max(0, Math.min(100, num(t.score))) })).filter((t) => t.topic),
    notes,
    reviewerSummaries,
    disagreements: [...disputeNotes.values()],
    usedModels: models.map((m) => `${m.providerLabel} · ${m.model}`),
    usage: ledger.summarize(),
    timing: { startedAt, finishedAt, durationMs: finishedAt - startedAt },
  }
}

/* ------------------------- Phase 4: COACHING ------------------------- */

function coachUserPrompt(extraction: Extraction, questions: QuestionResult[]): string {
  const rows = questions.map((q) => {
    const ratio = q.maxMarks != null ? `${q.awardedMarks}/${q.maxMarks}` : `${q.awardedMarks}/?`
    return `- ${q.number} [${q.verdict}] ${ratio} — mistakes: ${q.mistakes.slice(0, 3).join('; ') || 'none recorded'}; correct: ${q.whatWasCorrect.slice(0, 3).join('; ') || 'none recorded'}`
  })
  return `FINAL MARKED RESULTS (do not change any marks):
${rows.join('\n')}

PAPER: ${extraction.paperTitle || '(untitled)'} — SUBJECT: ${extraction.subject || '(unspecified)'}
Produce the coaching report for this student now. Remember: also return questionTopics with a short topic label for EVERY question number listed above.`
}

async function runCoach(
  model: ModelRef,
  extraction: Extraction,
  questions: QuestionResult[],
  ledger: TokenLedger,
  onProgress: (e: ProgressEvent) => void,
): Promise<{ summary: string; strengths: string[]; weaknesses: string[]; suggestions: string[]; recommendations: string[]; topicMastery: Array<{ topic: string; score: number }>; questionTopics: Map<string, string>; confidence: number }> {
  const key = modelRefKey(model)
  onProgress({ stage: 'coaching', models: [{ key, label: model.providerLabel, model: model.model, state: 'running' }], tokens: ledgerLive(ledger) })
  const raw = await callJSON(model, {
    system: coachSystemPrompt(),
    user: coachUserPrompt(extraction, questions),
    images: [],
    schema: COACH_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'paper_examiner_coach',
    maxTokens: 3500,
  }, ledger, 'coach')
  const questionTopics = new Map<string, string>()
  for (const t of objArr(raw.questionTopics)) {
    const n = String(t.number ?? '').trim()
    if (n) questionTopics.set(n, String(t.topic ?? ''))
  }
  onProgress({ stage: 'coaching', models: [{ key, label: model.providerLabel, model: model.model, state: 'done' }], tokens: ledgerLive(ledger) })
  return {
    summary: String(raw.summary ?? ''),
    strengths: strArr(raw.strengths),
    weaknesses: strArr(raw.weaknesses),
    suggestions: strArr(raw.suggestions),
    recommendations: strArr(raw.recommendations),
    topicMastery: objArr(raw.topicMastery).map((t) => ({ topic: String(t.topic ?? ''), score: num(t.score) })),
    questionTopics,
    confidence: num(raw.confidence, 70),
  }
}

/* ================================ THE ENGINE ================================ */

export async function runExamination(opts: {
  mode: 'single' | 'agent'
  models: ModelRef[]
  material: string
  images: ImagePart[]
  declaredTotal: number | null
  onProgress: (e: ProgressEvent) => void
}): Promise<UnifiedReport> {
  const { mode, models, material, images, declaredTotal, onProgress } = opts
  if (models.length === 0) throw new AIError('NO_KEY', 'errors.noModels')
  const primary = models[0]
  const ledger = new TokenLedger()
  const startedAt = Date.now()

  const emitTokens = () => onProgress({ stage: currentStage, tokens: ledgerLive(ledger) })
  let currentStage: PipelineStage = 'preparing'
  const setStage = (s: PipelineStage, extra?: Partial<ProgressEvent>) => {
    currentStage = s
    onProgress({ stage: s, ...extra, tokens: ledgerLive(ledger) })
  }

  setStage('preparing')

  /* Phase 1 — extraction */
  const extraction = await runExtraction(primary, material, images, declaredTotal, ledger, (e) => {
    currentStage = e.stage
    onProgress({ ...e, tokens: e.tokens ?? ledgerLive(ledger) })
  })
  const totalQ = extraction.questions.length

  /* Phase 2 — marking */
  const finalFindings = new Map<string, GradedFinding>()
  const disputeNotes = new Map<string, string>()
  const reviewers: ReviewerBlock[] = []
  const chips: QuestionChip[] = []
  let marked = 0

  const emitChips = (stage: PipelineStage) => {
    onProgress({ stage, questionResults: [...chips], counts: { done: marked, total: totalQ }, tokens: ledgerLive(ledger) })
  }

  if (mode === 'single') {
    setStage('grading', {
      models: [{ key: modelRefKey(primary), label: primary.providerLabel, model: primary.model, state: 'running' }],
      counts: { done: 0, total: totalQ },
    })
    const { findings, failedBatches } = await gradeWithModel(
      primary, null, extraction.questions, images, HARNESS.gradeBatchSize, 'grade', ledger,
      (found) => {
        for (const f of found) {
          finalFindings.set(f.number, f)
          const q = extraction.questions.find((x) => x.number === f.number)
          chips.push({ number: f.number, awarded: f.awardedMarks, max: q?.marks ?? null, verdict: f.verdict })
          marked += 1
        }
        emitChips('grading')
      },
      () => { currentStage = 'grading'; emitTokens() },
    )
    const failedNote = failedBatches.length > 0 ? `Some marking calls failed (${failedBatches.length} batch(es): ${failedBatches.map((b) => `[${b}]`).join(' ')}). Affected questions were marked 0/unclear — re-run for a complete result.` : ''
    if (failedNote) extraction.notes.push(failedNote)
    setStage('grading', {
      models: [{ key: modelRefKey(primary), label: primary.providerLabel, model: primary.model, state: 'done' }],
      counts: { done: marked, total: totalQ }, questionResults: [...chips],
    })
  } else {
    /* Agent mode: 3 independent reviewers round-robin across the selected models */
    const reviewerStates = (): ModelProgress[] => models.map((m) => ({ key: modelRefKey(m), label: m.providerLabel, model: m.model, state: 'pending' }))
    const roleNames = ['Strict', 'Fair', 'Error hunter']
    setStage('reviewing', { models: reviewerStates().map((m) => ({ ...m, state: 'running' as ModelState })), counts: { done: 0, total: totalQ }, detail: `${REVIEWER_ROLES.length} reviewers` })

    const reviewerJobs = REVIEWER_ROLES.map((role, i) => ({ role, roleName: roleNames[i], model: models[i % models.length], index: i }))
    await Promise.all(reviewerJobs.map(async (job) => {
      const { findings } = await gradeWithModel(
        job.model, job.role, extraction.questions, images, HARNESS.agentReviewBatchSize, 'review', ledger,
        (found, batchIndex, batchCount) => {
          void batchIndex; void batchCount
          // chips reflect consensus only — emitted after reconcile below
        },
        () => { currentStage = 'reviewing'; emitTokens() },
      )
      reviewers.push({ model: job.model.model, providerLabel: job.model.providerLabel, role: job.roleName, findings })
      const done = reviewerStates().map((m) => (m.key === modelRefKey(job.model) ? { ...m, state: 'done' as ModelState, detail: job.roleName } : m))
      setStage('reviewing', { models: done, counts: { done: marked, total: totalQ }, tokens: ledgerLive(ledger) })
    }))
    // deterministic reviewer order (role order), regardless of completion order
    reviewers.sort((a, b) => roleNames.indexOf(a.role) - roleNames.indexOf(b.role))

    /* Phase 3 — deterministic reconcile + dispute-only adjudication */
    setStage('adjudicating', { models: reviewerStates().map((m) => ({ ...m, state: 'done' as ModelState })), counts: { done: 0, total: totalQ } })
    const disputed: Array<{ question: ExtractedQuestion; votes: Array<{ reviewer: string; model: string; finding: GradedFinding }> }> = []

    for (const q of extraction.questions) {
      const votes = reviewers
        .map((r) => ({ reviewer: r.role, model: r.model, finding: r.findings.get(q.number) }))
        .filter((v): v is { reviewer: string; model: string; finding: GradedFinding } => v.finding != null)
      if (votes.length === 0) {
        finalFindings.set(q.number, {
          number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
          explanation: 'No reviewer produced a result for this question.', evidence: [], mistakes: [], whatWasCorrect: [],
        })
        continue
      }
      // adopt the finding of the reviewer whose mark equals the median (self-consistent verdict+marks)
      const med = medianMark(votes.map((v) => clampFinding(v.finding, q).finding.awardedMarks))
      let adopted = votes.reduce((best, v) => {
        const d = Math.abs(clampFinding(v.finding, q).finding.awardedMarks - med)
        const dBest = Math.abs(clampFinding(best.finding, q).finding.awardedMarks - med)
        return d < dBest ? v : best
      }, votes[0])
      finalFindings.set(q.number, adopted.finding)

      // dispute detection
      const marks = votes.map((v) => clampFinding(v.finding, q).finding.awardedMarks)
      const spread = Math.max(...marks) - Math.min(...marks)
      const tolerance = q.marks != null ? Math.max(1, q.marks * HARNESS.disputeTolerance) : 1
      const verdicts = votes.map((v) => v.finding.verdict)
      const verdictClash = verdicts.includes('correct') && (verdicts.includes('incorrect') || verdicts.includes('unanswered'))
      if (spread > tolerance || verdictClash) {
        disputed.push({ question: q, votes: votes.map((v) => ({ reviewer: v.reviewer, model: v.model, finding: v.finding })) })
      }
    }

    if (disputed.length > 0) {
      const adjKey = modelRefKey(primary)
      setStage('adjudicating', {
        models: [{ key: adjKey, label: primary.providerLabel, model: primary.model, state: 'running', detail: `${disputed.length} disputes` }],
        counts: { done: 0, total: totalQ },
      })
      const batches = chunk(disputed, HARNESS.adjudicateBatchSize)
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const { images: adjImages, mapping } = pickImages(batch.map((d) => d.question), images)
        try {
          const raw = await callJSON(primary, {
            system: adjudicationSystemPrompt(),
            user: adjudicationUserPrompt(batch, mapping, images),
            images: adjImages,
            schema: ADJUDICATION_SCHEMA as unknown as Record<string, unknown>,
            schemaName: 'paper_examiner_adjudication',
            maxTokens: 6000,
          }, ledger, 'adjudicate', `batch ${i + 1}/${batches.length}`)
          for (const f of normalizeFindings(raw, batch.map((d) => d.question))) {
            const d = batch.find((x) => x.question.number === f.number)
            if (!d) continue
            finalFindings.set(f.number, f)
            const votesLine = d.votes.map((v) => `${v.finding.awardedMarks}`).join(' / ')
            disputeNotes.set(f.number, f.resolutionNote || `Reviewers proposed ${votesLine} — adjudicated to ${f.awardedMarks}.`)
          }
        } catch {
          // adjudication failed → keep the median finding, note the failure
          for (const d of batch) {
            disputeNotes.set(d.question.number, 'Adjudication call failed — the median reviewer mark was kept.')
          }
        }
        setStage('adjudicating', {
          models: [{ key: adjKey, label: primary.providerLabel, model: primary.model, state: i < batches.length - 1 ? 'running' : 'done' }],
          counts: { done: 0, total: totalQ }, tokens: ledgerLive(ledger),
        })
      }
    }

    // chips now reflect the reconciled results
    for (const q of extraction.questions) {
      const f = finalFindings.get(q.number)
      chips.push({ number: q.number, awarded: f?.awardedMarks ?? 0, max: q.marks, verdict: f?.verdict ?? 'unclear' })
      marked += 1
    }
    emitChips('adjudicating')
  }

  /* Phase 5 — pre-coach snapshot with empty topics, then coach, then topics fill-in */
  const preCoach = extraction.questions.map((q) => {
    const { finding, adjusted } = clampFinding(finalFindings.get(q.number) ?? {
      number: q.number, verdict: 'unclear', awardedMarks: 0, answerLocated: false,
      explanation: 'No marking result was produced for this question.', evidence: [], mistakes: [], whatWasCorrect: [],
    }, q)
    return {
      number: q.number, topic: '', maxMarks: q.marks, verdict: finding.verdict,
      awardedMarks: round2(finding.awardedMarks), explanation: finding.explanation,
      evidence: finding.evidence, mistakes: finding.mistakes, whatWasCorrect: finding.whatWasCorrect,
      adjusted, dispute: disputeNotes.get(q.number),
    } satisfies QuestionResult
  })

  const coach = await runCoach(primary, extraction, preCoach, ledger, (e) => { currentStage = e.stage; onProgress(e) })

  /* Phase 6 — deterministic aggregate */
  setStage('finishing', { counts: { done: totalQ, total: totalQ }, questionResults: [...chips] })
  const report = buildReport({
    mode, extraction, finalFindings, disputeNotes, coach, reviewers, models, declaredTotal, ledger, startedAt,
  })
  onProgress({ stage: 'finishing', tokens: ledgerLive(ledger) })
  return report
}

/* ------------------------- Legacy single/agent runners ------------------------- */

export async function runSingleMode(model: ModelRef, material: string, images: ImagePart[], declaredTotal: number | null, onProgress: (e: ProgressEvent) => void): Promise<UnifiedReport> {
  return runExamination({ mode: 'single', models: [model], material, images, declaredTotal, onProgress })
}

export async function runAgentMode(models: ModelRef[], material: string, images: ImagePart[], declaredTotal: number | null, onProgress: (e: ProgressEvent) => void): Promise<UnifiedReport> {
  return runExamination({ mode: 'agent', models, material, images, declaredTotal, onProgress })
}
