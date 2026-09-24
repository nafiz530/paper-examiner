import type { ProxyErr, ProxyErrorCode, ProxyRequest } from '../../shared/aiWire'
import { LIMITS, type ServerProvider } from './config'

/** Thrown by adapters; carries a safe, key-free message and whether trying another key could help. */
export class UpstreamError extends Error {
  code: ProxyErrorCode
  httpStatus: number
  /** true → this KEY is at fault (dead/quota/rate-limited): rotate to the next key */
  rotateKey: boolean
  constructor(code: ProxyErrorCode, message: string, httpStatus: number, rotateKey = false) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
    this.rotateKey = rotateKey
  }
  toWire(): ProxyErr {
    return { ok: false, code: this.code, message: this.message }
  }
}

const OPENAI_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
}

/** Gemini 3.x rejects legacy sampling params; only send temperature to 1.5/2.x. */
export const supportsLegacySampling = (model: string) => /^gemini-(1\.5|2\.)/.test(model.trim())

/** Redact anything that looks like a credential before any text leaves the server. */
export function redact(text: string, keys: string[] = []): string {
  let out = text
  for (const k of keys) if (k) out = out.split(k).join('[redacted]')
  return out
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\b(sk|gsk|pk)[-_][A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [redacted]')
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new UpstreamError('UPSTREAM_TIMEOUT', 'The AI provider took too long to respond.', 504)
    throw new UpstreamError('UPSTREAM_SERVER', 'Could not reach the AI provider.', 502)
  } finally {
    clearTimeout(timer)
  }
}

/** Map an upstream HTTP status onto a safe error. Auth/quota failures are the KEY's fault → rotate. */
function classify(status: number, detail: string, keys: string[]): UpstreamError {
  const safe = redact(detail, keys).slice(0, 300)
  if (status === 401 || status === 403) {
    // Never tell the browser WHY a shared key failed beyond "unavailable" — it may reveal key state.
    return new UpstreamError('UPSTREAM_AUTH', 'The shared AI key was rejected by the provider.', 503, true)
  }
  if (status === 402 || status === 429) return new UpstreamError('UPSTREAM_QUOTA', 'The shared AI quota is exhausted right now.', 429, true)
  if (status === 404) return new UpstreamError('BAD_MODEL', 'The provider does not recognise this model.', 502)
  if (status === 400 || status === 413 || status === 422) return new UpstreamError('UPSTREAM_BAD_REQUEST', safe || 'The provider rejected the request.', 400)
  if (status === 408) return new UpstreamError('UPSTREAM_TIMEOUT', 'The AI provider timed out.', 504)
  return new UpstreamError('UPSTREAM_SERVER', 'The AI provider had a temporary problem.', 502)
}

async function errorDetail(r: Response): Promise<string> {
  const raw = await r.text().catch(() => '')
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    if (typeof j?.error === 'string') return j.error
    if (j?.error?.message) return j.error.message
    if (j?.message) return j.message
  } catch { /* fall through */ }
  return raw
}

/* ---------------------------------- Gemini ---------------------------------- */

export async function callGeminiUpstream(req: ProxyRequest, key: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: req.user }]
  for (const img of req.images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens,
    responseMimeType: 'application/json',
    responseSchema: req.schema,
  }
  if (supportsLegacySampling(req.model)) generationConfig.temperature = 0.15

  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
    safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({
      category: `HARM_CATEGORY_${c}`,
      threshold: 'BLOCK_ONLY_HIGH',
    })),
  }

  // Key goes in a HEADER, never the URL, so it cannot end up in logs/redirects.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`
  const r = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  }, LIMITS.upstreamTimeoutMs)

  if (!r.ok) throw classify(r.status, await errorDetail(r), [key])

  let json: {
    promptFeedback?: { blockReason?: string }
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>
  }
  try { json = await r.json() as typeof json } catch { throw new UpstreamError('UPSTREAM_UNREADABLE', 'The AI provider returned an unreadable response.', 502) }

  if (json.promptFeedback?.blockReason) {
    throw new UpstreamError('UPSTREAM_BAD_REQUEST', `Blocked by the provider's safety filter (${json.promptFeedback.blockReason}).`, 400)
  }
  const cand = json.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p) => p.text || '').join('')
  if (!text.trim()) throw new UpstreamError('UPSTREAM_UNREADABLE', `The AI provider returned an empty answer${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`, 502)
  if (cand?.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
    // Truncated JSON is poison: report as retryable-unreadable so the browser re-runs the step.
    throw new UpstreamError('UPSTREAM_UNREADABLE', `Output was cut off (${cand.finishReason}).`, 502)
  }
  return text
}

/* ------------------------------ OpenAI-compatible ------------------------------ */

export async function callOpenAICompatUpstream(
  provider: ServerProvider,
  req: ProxyRequest,
  key: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const endpoint = OPENAI_ENDPOINTS[provider.type]
  if (!endpoint) throw new UpstreamError('NOT_CONFIGURED', 'This provider type is not proxyable.', 500)

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: req.user }]
  for (const img of req.images) content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  if (provider.type === 'openrouter') {
    headers['HTTP-Referer'] = origin
    headers['X-Title'] = 'Paper Examiner'
  }

  const base = {
    model: req.model,
    messages: [{ role: 'system', content: req.system }, { role: 'user', content }],
    temperature: 0.15,
    max_tokens: req.maxTokens,
  }
  // strict json_schema → json_object → plain: some providers reject one of the modes with a 400.
  const attempts: Array<Record<string, unknown>> = [
    { ...base, response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } } },
    { ...base, response_format: { type: 'json_object' } },
    base,
  ]

  let last: UpstreamError | null = null
  for (let i = 0; i < attempts.length; i++) {
    const r = await fetchWithTimeout(fetchImpl, endpoint, { method: 'POST', headers, body: JSON.stringify(attempts[i]) }, LIMITS.upstreamTimeoutMs)
    if (r.ok) {
      let json: { choices?: Array<{ message?: { content?: unknown } }> }
      try { json = await r.json() as typeof json } catch { throw new UpstreamError('UPSTREAM_UNREADABLE', 'The AI provider returned an unreadable response.', 502) }
      const c = json?.choices?.[0]?.message?.content
      if (typeof c === 'string' && c.trim()) return c
      if (Array.isArray(c)) {
        const joined = c.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text || '')).join('')
        if (joined.trim()) return joined
      }
      throw new UpstreamError('UPSTREAM_UNREADABLE', 'The AI provider returned an empty answer.', 502)
    }
    const err = classify(r.status, await errorDetail(r), [key])
    if (err.code === 'UPSTREAM_BAD_REQUEST' && i < attempts.length - 1) { last = err; continue }
    throw err
  }
  throw last ?? new UpstreamError('UPSTREAM_SERVER', 'The AI provider had a temporary problem.', 502)
}

/* ---------------------------------- Router ---------------------------------- */

export function callUpstream(
  provider: ServerProvider,
  req: ProxyRequest,
  key: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return provider.type === 'gemini'
    ? callGeminiUpstream(req, key, fetchImpl)
    : callOpenAICompatUpstream(provider, req, key, origin, fetchImpl)
}
