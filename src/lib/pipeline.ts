import type { ModelRef } from './settings'
import { withKeyRotation } from './keyPool'
import { AIError, toAIError } from './aiErrors'
import { callModelText, type ImagePart } from './providers'
import {
  ADJUDICATION_SCHEMA, RECONSTRUCTION_SCHEMA, REVIEW_SCHEMA, SINGLE_SCHEMA,
  REVIEWER_ROLES, adjudicatorSystemPrompt, reconstructionSystemPrompt,
  reviewerSystemPrompt, singleModeSystemPrompt,
} from './prompts'

export type PipelineStage = 'preparing' | 'reconstructing' | 'reviewing' | 'adjudicating' | 'grading' | 'finishing'

export type ModelState = 'pending' | 'running' | 'done' | 'error'

export type ModelProgress = {
  key: string
  label: string
  model: string
  state: ModelState
  detail?: string
}

export type ProgressEvent = {
  stage: PipelineStage
  detail?: string
  models?: ModelProgress[]
}

export type QuestionResult = {
  number: string
  topic: string
  maxMarks: number | null
  verdict: string
  awardedMarks: number
  explanation: string
  evidence: string[]
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
  reviewerSummaries: Array<{ model: string; proposedTotalMarks: number; confidence: number; summary: string }>
  disagreements: string[]
  usedModels: string[]
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

async function callJSON(
  model: ModelRef,
  opts: { system: string; user: string; images: ImagePart[]; schema: Record<string, unknown>; schemaName: string; maxTokens: number },
): Promise<Record<string, unknown>> {
  const raw = await withKeyRotation(model, (apiKey) => callModelText({
    type: model.type,
    baseURL: model.baseURL,
    model: model.model,
    apiKey,
    system: opts.system,
    user: opts.user,
    images: opts.images,
    schema: opts.schema,
    schemaName: opts.schemaName,
    maxTokens: opts.maxTokens,
  }))
  try {
    return extractJson(raw)
  } catch {
    // one repair attempt with a stricter reminder
    const retry = await withKeyRotation(model, (apiKey) => callModelText({
      type: model.type, baseURL: model.baseURL, model: model.model, apiKey,
      system: opts.system,
      user: `${opts.user}\n\nIMPORTANT: Your previous reply was not valid JSON. Reply with ONLY one valid JSON object matching the schema. No markdown, no commentary.`,
      images: opts.images,
      schema: opts.schema,
      schemaName: opts.schemaName,
      maxTokens: opts.maxTokens,
    }))
    return extractJson(retry)
  }
}

/* ------------------------------- Material prep ------------------------------- */

function materialSummary(questions: string[], answers: string[]): string {
  return `QUESTION PAPER ITEMS:\n${questions.join('\n\n') || '(none)'}\n\nSTUDENT ANSWER ITEMS:\n${answers.join('\n\n') || '(none)'}\n\nThe images themselves are attached to this request.`
}

/* ------------------------------- Single mode --------------------------------- */

export async function runSingleMode(model: ModelRef, material: string, images: ImagePart[], onProgress: (e: ProgressEvent) => void): Promise<Record<string, unknown>> {
  onProgress({ stage: 'preparing', models: [{ key: modelRefKey(model), label: model.providerLabel, model: model.model, state: 'running' }] })
  onProgress({ stage: 'grading', detail: model.model, models: [{ key: modelRefKey(model), label: model.providerLabel, model: model.model, state: 'running' }] })
  const result = await callJSON(model, {
    system: singleModeSystemPrompt(),
    user: `Examine this exam paper and the student's answers now.\n\n${material}`,
    images,
    schema: SINGLE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'paper_examiner_single',
    maxTokens: 8000,
  })
  onProgress({ stage: 'finishing', models: [{ key: modelRefKey(model), label: model.providerLabel, model: model.model, state: 'done' }] })
  return result
}

/* -------------------------------- Agent mode --------------------------------- */

export async function runAgentMode(models: ModelRef[], material: string, images: ImagePart[], onProgress: (e: ProgressEvent) => void): Promise<Record<string, unknown>> {
  if (models.length === 0) throw new AIError('NO_KEY', 'errors.noModels')
  const primary = models[0]
  const modelStates = (): ModelProgress[] => models.map((m) => ({ key: modelRefKey(m), label: m.providerLabel, model: m.model, state: 'pending' }))
  const setState = (arr: ModelProgress[], key: string, state: ModelState, detail?: string) =>
    arr.map((m) => (m.key === key ? { ...m, state, detail } : m))

  // 1. Reconstruction (primary model)
  let progress = modelStates()
  progress = setState(progress, modelRefKey(primary), 'running')
  onProgress({ stage: 'reconstructing', models: progress })
  const reconstruction = await callJSON(primary, {
    system: reconstructionSystemPrompt(),
    user: `Reconstruct the question paper and the student's submitted solutions.\n\n${material}`,
    images,
    schema: RECONSTRUCTION_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'paper_examiner_reconstruction',
    maxTokens: 8000,
  }).catch((e) => { throw toAIError(e) })
  progress = setState(progress, modelRefKey(primary), 'done')
  onProgress({ stage: 'reconstructing', models: progress })

  // 2. Independent reviewers, round-robin across ALL selected models ("multiple models under one exam")
  const reviewerJobs = REVIEWER_ROLES.map((role, i) => ({ role, model: models[i % models.length], index: i }))
  progress = modelStates().map((m) => ({ ...m, state: 'running' as ModelState, detail: 'reviewing' }))
  onProgress({ stage: 'reviewing', detail: `${reviewerJobs.length} independent reviewers`, models: progress })

  const reviews = await Promise.all(reviewerJobs.map(async (job) => {
    const key = modelRefKey(job.model)
    try {
      const review = await callJSON(job.model, {
        system: reviewerSystemPrompt(job.role),
        user: `Independently review and mark the student's answers against the reconstructed paper.\n\nRECONSTRUCTED PAPER:\n${JSON.stringify(reconstruction)}\n\nRAW MATERIAL:\n${material}`,
        images,
        schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'paper_examiner_review',
        maxTokens: 7000,
      })
      const p = setState(progress, key, 'done')
      onProgress({ stage: 'reviewing', models: p })
      return { model: job.model, review }
    } catch (e) {
      const err = toAIError(e)
      const p = setState(progress, key, 'error', err.i18nKey)
      onProgress({ stage: 'reviewing', models: p })
      throw err
    }
  }))

  // 3. Adjudication (primary model)
  progress = setState(progress, modelRefKey(primary), 'running', 'adjudicating')
  onProgress({ stage: 'adjudicating', models: progress })
  const totalHint = reconstruction.totalMarksDetected
  const adjudication = await callJSON(primary, {
    system: adjudicatorSystemPrompt(),
    user: `Produce the final adjudicated report from the independent reviews below.${totalHint ? ` The paper's total marks appear to be ${totalHint}.` : ''}\n\nRECONSTRUCTED PAPER:\n${JSON.stringify(reconstruction)}\n\nINDEPENDENT REVIEWER REPORTS:\n${JSON.stringify(reviews.map((r) => r.review))}\n\nRAW MATERIAL:\n${material}`,
    images,
    schema: ADJUDICATION_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'paper_examiner_adjudication',
    maxTokens: 8000,
  })
  progress = setState(progress, modelRefKey(primary), 'done')
  onProgress({ stage: 'finishing', models: progress })

  return { ...adjudication, __reviews: reviews.map((r) => ({ model: r.model.model, review: r.review })) }
}

/* -------------------------------- Normalizing -------------------------------- */

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
}

export function modelRefKey(m: ModelRef): string {
  return `${m.source}:${m.providerId}:${m.model}`
}

export function normalizeReport(raw: Record<string, unknown>, mode: 'single' | 'agent', models: ModelRef[]): UnifiedReport {
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const objArr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => !!x && typeof x === 'object') as Array<Record<string, unknown>>) : [])

  const questions: QuestionResult[] = objArr(raw.questions ?? raw.questionResults).map((q) => {
    const maxMarks = q.maxMarks != null && typeof q.maxMarks === 'number' ? q.maxMarks : null
    const awarded = Math.max(0, Math.min(num(q.awardedMarks ?? q.awarded), maxMarks ?? num(q.awardedMarks ?? q.awarded)))
    return {
      number: String(q.number ?? q.questionNumber ?? '—'),
      topic: String(q.topic ?? ''),
      maxMarks,
      verdict: typeof q.verdict === 'string' ? q.verdict : 'unclear',
      awardedMarks: awarded,
      explanation: String(q.explanation ?? q.reasoning ?? ''),
      evidence: strArr(q.evidence),
    }
  })

  const totalMarks = Math.max(1, num(raw.totalMarks))
  const obtained = Math.max(0, Math.min(num(raw.obtainedMarks), totalMarks))
  const reviewsRaw = Array.isArray(raw.__reviews) ? raw.__reviews as Array<Record<string, unknown>> : []

  return {
    reportLanguage: typeof raw.reportLanguage === 'string' ? raw.reportLanguage : 'en',
    mode,
    paperTitle: String(raw.paperTitle ?? ''),
    subject: String(raw.subject ?? ''),
    totalMarks,
    obtainedMarks: obtained,
    percentage: Math.round((obtained / totalMarks) * 10000) / 100,
    grade: String(raw.grade ?? ''),
    confidence: Math.max(0, Math.min(100, num(raw.confidence))),
    summary: String(raw.summary ?? ''),
    questions,
    strengths: strArr(raw.strengths ?? raw.strongPoints),
    weaknesses: strArr(raw.weaknesses ?? raw.weakPoints),
    suggestions: strArr(raw.suggestions),
    recommendations: strArr(raw.recommendations),
    topicMastery: objArr(raw.topicMastery).map((t) => ({ topic: String(t.topic ?? ''), score: Math.max(0, Math.min(100, num(t.score))) })).filter((t) => t.topic),
    notes: strArr(raw.notes),
    reviewerSummaries: reviewsRaw.map((r) => {
      const review = (r.review ?? {}) as Record<string, unknown>
      return { model: String(r.model ?? ''), proposedTotalMarks: num(review.proposedTotalMarks), confidence: num(review.confidence), summary: String(review.summary ?? '') }
    }),
    disagreements: strArr(raw.reviewerDisagreements),
    usedModels: models.map((m) => `${m.providerLabel} · ${m.model}`),
  }
}
