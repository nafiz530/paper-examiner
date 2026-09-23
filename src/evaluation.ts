import type { AIConfig, AIProvider } from './ai'
import type { ExamRecord, PaperItem } from './db'

export type PipelineStage = 'reconstructing' | 'reviewing' | 'adjudicating' | 'reporting'

export type ReconstructedQuestion = {
  id: string
  number: string
  prompt: string
  marks: number | null
  parts: string[]
  sourceItemIds: string[]
}

export type ReconstructedAnswer = {
  questionNumber: string
  answer: string
  sourceItemIds: string[]
}

export type Reconstruction = {
  questions: ReconstructedQuestion[]
  answers: ReconstructedAnswer[]
  totalMarksDetected: number | null
  notes: string[]
}

export type ReviewFinding = {
  questionNumber: string
  verdict: 'correct' | 'partially_correct' | 'incorrect' | 'unanswered' | 'unclear'
  awardedMarks: number
  maxMarks: number | null
  reasoning: string
  evidence: string[]
  missingOrWrong: string[]
}

export type Reviewer = {
  id: string
  role: string
}

export type StructuredReview = {
  reviewerId: string
  reviewerRole: string
  proposedTotalMarks: number
  confidence: number
  summary: string
  findings: ReviewFinding[]
  strengths: string[]
  weaknesses: string[]
}

export type Adjudication = {
  obtainedMarks: number
  totalMarks: number
  percentage: number
  confidence: number
  summary: string
  questionResults: Array<{
    questionNumber: string
    awardedMarks: number
    maxMarks: number | null
    verdict: ReviewFinding['verdict']
    explanation: string
    evidence: string[]
  }>
  strongPoints: string[]
  weakPoints: string[]
  actionableAdvice: string[]
  reviewerDisagreements: string[]
}

export type EvaluationResult = {
  id: string
  createdAt: number
  reconstruction: Reconstruction
  reviews: StructuredReview[]
  adjudication: Adjudication
}

export const DEFAULT_REVIEWERS: Reviewer[] = [
  { id: 'strict-marker', role: 'Strict examiner: enforce the question wording, marking scheme logic, and maximum marks.' },
  { id: 'fair-marker', role: 'Fair examiner: award credit for correct reasoning and valid equivalent methods without being generous.' },
  { id: 'error-hunter', role: 'Error hunter: actively search for missing steps, factual errors, arithmetic mistakes, unsupported claims, and over-crediting.' },
]

const RECONSTRUCTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: {
      type: 'object', properties: {
        id: { type: 'string' }, number: { type: 'string' }, prompt: { type: 'string' },
        marks: { type: ['number', 'null'] }, parts: { type: 'array', items: { type: 'string' } },
        sourceItemIds: { type: 'array', items: { type: 'string' } },
      }, required: ['id','number','prompt','marks','parts','sourceItemIds'], additionalProperties: false,
    }},
    answers: { type: 'array', items: {
      type: 'object', properties: {
        questionNumber: { type: 'string' }, answer: { type: 'string' },
        sourceItemIds: { type: 'array', items: { type: 'string' } },
      }, required: ['questionNumber','answer','sourceItemIds'], additionalProperties: false,
    }},
    totalMarksDetected: { type: ['number','null'] },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['questions','answers','totalMarksDetected','notes'],
  additionalProperties: false,
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviewerId: { type: 'string' }, reviewerRole: { type: 'string' },
    proposedTotalMarks: { type: 'number' }, confidence: { type: 'number' },
    summary: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', properties: {
        questionNumber: { type: 'string' },
        verdict: { type: 'string', enum: ['correct','partially_correct','incorrect','unanswered','unclear'] },
        awardedMarks: { type: 'number' }, maxMarks: { type: ['number','null'] },
        reasoning: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } },
        missingOrWrong: { type: 'array', items: { type: 'string' } },
      }, required: ['questionNumber','verdict','awardedMarks','maxMarks','reasoning','evidence','missingOrWrong'], additionalProperties: false,
    }},
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
  },
  required: ['reviewerId','reviewerRole','proposedTotalMarks','confidence','summary','findings','strengths','weaknesses'],
  additionalProperties: false,
}

const ADJUDICATION_SCHEMA = {
  type: 'object',
  properties: {
    obtainedMarks: { type: 'number' }, totalMarks: { type: 'number' }, percentage: { type: 'number' },
    confidence: { type: 'number' }, summary: { type: 'string' },
    questionResults: { type: 'array', items: {
      type: 'object', properties: {
        questionNumber: { type: 'string' }, awardedMarks: { type: 'number' }, maxMarks: { type: ['number','null'] },
        verdict: { type: 'string', enum: ['correct','partially_correct','incorrect','unanswered','unclear'] },
        explanation: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } },
      }, required: ['questionNumber','awardedMarks','maxMarks','verdict','explanation','evidence'], additionalProperties: false,
    }},
    strongPoints: { type: 'array', items: { type: 'string' } },
    weakPoints: { type: 'array', items: { type: 'string' } },
    actionableAdvice: { type: 'array', items: { type: 'string' } },
    reviewerDisagreements: { type: 'array', items: { type: 'string' } },
  },
  required: ['obtainedMarks','totalMarks','percentage','confidence','summary','questionResults','strongPoints','weakPoints','actionableAdvice','reviewerDisagreements'],
  additionalProperties: false,
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

async function partsForItems(items: PaperItem[]): Promise<Array<{ text?: string; image?: string; mimeType?: string; id: string }>> {
  const out: Array<{ text?: string; image?: string; mimeType?: string; id: string }> = []
  for (const item of items) {
    if (item.type === 'text') out.push({ text: `[TEXT ITEM ${item.id}]\n${item.text}`, id: item.id })
    else out.push({ image: await dataUrl(item.blob), mimeType: item.mimeType || item.blob.type || 'image/jpeg', id: item.id })
  }
  return out
}

function openAIContent(parts: Array<{ text?: string; image?: string; mimeType?: string }>, intro: string) {
  return [
    { type: 'text', text: intro },
    ...parts.flatMap(part => part.text
      ? [{ type: 'text', text: part.text }]
      : [{ type: 'image_url', image_url: { url: part.image } }]),
  ]
}

function geminiContents(parts: Array<{ text?: string; image?: string; mimeType?: string }>, intro: string) {
  return [{ role: 'user', parts: [
    { text: intro },
    ...parts.flatMap(part => part.text
      ? [{ text: part.text }]
      : [{ inlineData: { mimeType: part.mimeType, data: part.image!.split(',')[1] } }]),
  ] }]
}

async function parseResponse(response: Response): Promise<string> {
  const raw = await response.text()
  if (!response.ok) {
    let message = raw
    try { const json = JSON.parse(raw); message = json?.error?.message || json?.message || raw } catch {}
    throw new Error(message || `Request failed (${response.status})`)
  }
  try {
    const json = JSON.parse(raw)
    const content = json?.choices?.[0]?.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((x: any) => x?.text || '').join('')
    if (json?.candidates?.[0]?.content?.parts) return json.candidates[0].content.parts.map((x: any) => x.text || '').join('')
  } catch {}
  throw new Error('The provider returned an unreadable response.')
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '')
  try { return JSON.parse(cleaned) } catch {}
  const start = Math.min(...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter(x => x >= 0))
  if (!Number.isFinite(start)) throw new Error('Model did not return JSON.')
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (end < start) throw new Error('Model returned incomplete JSON.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function assertObject(value: unknown, label: string): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} returned an invalid structured result.`)
  return value
}

async function callStructured(config: AIConfig, prompt: string, items: PaperItem[], schema: unknown, maxTokens = 6000): Promise<any> {
  if (!config.apiKey.trim() || !config.model.trim()) throw new Error('Configure an API key and exact model ID in Examiner settings first.')
  const parts = await partsForItems(items)

  if (config.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model.trim())}:generateContent?key=${encodeURIComponent(config.apiKey.trim())}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: geminiContents(parts, prompt),
        generationConfig: { temperature: 0.15, maxOutputTokens: maxTokens, responseMimeType: 'application/json', responseSchema: schema },
      }),
    })
    return assertObject(extractJson(await parseResponse(response)), 'AI')
  }

  const endpoint = config.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
    : config.provider === 'mistral' ? 'https://api.mistral.ai/v1/chat/completions'
    : config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions'

  const body = {
    model: config.model.trim(),
    messages: [{ role: 'user', content: openAIContent(parts, prompt) }],
    temperature: 0.15,
    max_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: { name: 'paper_examiner_result', strict: true, schema } },
  }

  let response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey.trim() },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey.trim() },
      body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
    })
  }
  return assertObject(extractJson(await parseResponse(response)), 'AI')
}

function normalizeItems(items: PaperItem[]) {
  return items.map((item, index) => item.type === 'text'
    ? `ITEM ${index + 1} (id=${item.id}) TEXT:\n${item.text}`
    : `ITEM ${index + 1} (id=${item.id}) IMAGE id=${item.id} name=${item.name}`)
}

export async function runReconstruction(config: AIConfig, exam: ExamRecord): Promise<Reconstruction> {
  const prompt = `You are the reconstruction agent in a paper-marking pipeline.
Reconstruct the complete question paper and submitted solution from the raw mixed material below. The user may have uploaded pages out of order and may mix typed text with photos.
Do NOT grade anything. Preserve wording faithfully. Infer question boundaries, numbering, sub-parts, and marks when visible. Match solution material to question numbers when possible. Never invent missing text; flag uncertainty in notes.
Return only the requested JSON structure.

QUESTION-SIDE RAW ITEMS:
${normalizeItems(exam.questions).join('\n\n')}

SOLUTION-SIDE RAW ITEMS:
${normalizeItems(exam.answers).join('\n\n')}

The images themselves are attached separately in this request.`
  return runStructuredWithRetry(config, prompt, [...exam.questions, ...exam.answers], RECONSTRUCTION_SCHEMA, 8000) as Promise<Reconstruction>
}

export async function runReviewer(config: AIConfig, exam: ExamRecord, reconstruction: Reconstruction, reviewer: Reviewer): Promise<StructuredReview> {
  const prompt = `You are an independent exam reviewer. You are one of several reviewers and MUST work independently.
ROLE: ${reviewer.role}
Evaluate the student's solution against the reconstructed questions. Award marks conservatively and never exceed a question's maximum. If a mark allocation is unknown, use the best-supported interpretation and explain uncertainty.
Use evidence from the supplied paper material. Do not see or rely on other reviewers. Do not average anything.
Return only JSON matching the required schema.

RECONSTRUCTED PAPER:
${JSON.stringify(reconstruction)}

RAW MATERIAL CONTEXT:
Questions: ${normalizeItems(exam.questions).join('\n')}
Solutions: ${normalizeItems(exam.answers).join('\n')}`
  const result = await runStructuredWithRetry(config, prompt, [...exam.questions, ...exam.answers], REVIEW_SCHEMA, 7000)
  return { ...result, reviewerId: reviewer.id, reviewerRole: reviewer.role }
}

export async function runAdjudicator(config: AIConfig, exam: ExamRecord, reconstruction: Reconstruction, reviews: StructuredReview[]): Promise<Adjudication> {
  const total = exam.totalMarks ?? reconstruction.totalMarksDetected ?? reviews.reduce((m, r) => Math.max(m, r.proposedTotalMarks), 0)
  const prompt = `You are the MAIN ADJUDICATOR. Produce the final mark after independently reasoning over multiple reviewer reports.
CRITICAL: Do NOT average reviewer scores. Do not vote. Reconcile disagreements by examining the reconstructed question, student's answer, each review's evidence, maximum marks, and reasoning. Prefer conclusions supported by concrete evidence. If reviewers disagree, explicitly explain the resolution.
The final awarded marks must be derived question-by-question and cannot exceed maximum marks. Total marks should be ${total > 0 ? total : 'inferred from the paper'}.
Return only JSON matching the schema.

RECONSTRUCTED PAPER:
${JSON.stringify(reconstruction)}

INDEPENDENT REVIEW REPORTS:
${JSON.stringify(reviews)}`

  const result = await runStructuredWithRetry(config, prompt, [...exam.questions, ...exam.answers], ADJUDICATION_SCHEMA, 7000) as Adjudication
  const safeTotal = result.totalMarks > 0 ? result.totalMarks : total
  const safeObtained = Math.max(0, Math.min(result.obtainedMarks, safeTotal || result.obtainedMarks))
  return { ...result, totalMarks: safeTotal, obtainedMarks: safeObtained, percentage: safeTotal > 0 ? Math.round((safeObtained / safeTotal) * 10000) / 100 : 0 }
}

async function runStructuredWithRetry(config: AIConfig, prompt: string, items: PaperItem[], schema: unknown, maxTokens: number): Promise<any> {
  try {
    return await callStructured(config, prompt, items, schema, maxTokens)
  } catch (first) {
    const repairPrompt = `${prompt}

The previous attempt failed validation or formatting. Repeat the same task now. Return ONLY one valid JSON object matching the schema. No markdown fences, no commentary.`
    try { return await callStructured(config, repairPrompt, items, schema, maxTokens) }
    catch { throw first }
  }
}

export async function runEvaluationPipeline(config: AIConfig, exam: ExamRecord, onStage?: (stage: PipelineStage, detail: string) => void): Promise<EvaluationResult> {
  onStage?.('reconstructing', 'Rebuilding the paper structure from raw material…')
  const reconstruction = await runReconstruction(config, exam)

  onStage?.('reviewing', `Running ${DEFAULT_REVIEWERS.length} independent reviewers…`)
  const reviews = await Promise.all(DEFAULT_REVIEWERS.map((reviewer, i) =>
    runReviewer(config, exam, reconstruction, reviewer).then(result => {
      onStage?.('reviewing', `Independent reviewer ${i + 1}/${DEFAULT_REVIEWERS.length} finished.`)
      return result
    })
  ))

  onStage?.('adjudicating', 'Main Agent is reconciling evidence — not averaging scores…')
  const adjudication = await runAdjudicator(config, exam, reconstruction, reviews)

  onStage?.('reporting', 'Building the final report…')
  return { id: crypto.randomUUID(), createdAt: Date.now(), reconstruction, reviews, adjudication }
}
