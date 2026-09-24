import type { ProviderType } from '../config/examiner.config'
import { AIError, classifyStatus, networkError, timeoutError } from './aiErrors'
import { createGeminiClient, geminiJsonConfig, readGeminiResponse, toGeminiAIError } from './gemini'
import { estimateUsage, usageFromRaw, type Usage } from './tokens'
import type { Part } from '@google/genai'
import type { ProxyErr, ProxyOk, ProxyRequest } from '../../shared/aiWire'

export type ImagePart = { mimeType: string; dataUrl: string }

/** Result of one model call: the text plus real token usage when the provider reports it. */
export type CallResult = { text: string; usage?: Usage }

export type CallArgs = {
  type: ProviderType
  baseURL?: string
  model: string
  /** BYOK key. Empty when `proxy` is set — shared keys never reach the browser. */
  apiKey: string
  /** When set, the call goes to our own /api/ai proxy (the shared "Provided for you" tier). */
  proxy?: { providerId: string; turnstileToken?: string }
  system: string
  user: string
  images: ImagePart[]
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  timeoutMs?: number
}

const TIMEOUT_MS = 90_000

type OpenAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

function openAIEndpoint(type: ProviderType, baseURL?: string): string {
  switch (type) {
    case 'openai': return 'https://api.openai.com/v1/chat/completions'
    case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions'
    case 'groq': return 'https://api.groq.com/openai/v1/chat/completions'
    case 'mistral': return 'https://api.mistral.ai/v1/chat/completions'
    case 'custom': return (baseURL || '').replace(/\/+$/, '') + '/chat/completions'
    case 'gemini': return '' // handled separately
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  try {
    const json = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    if (typeof json?.error === 'string') return json.error
    if (json?.error?.message) return json.error.message
    if (json?.message) return json.message
  } catch { /* raw fallback below */ }
  return raw.slice(0, 300) || `HTTP ${response.status}`
}

async function readContent(response: Response): Promise<{ text: string; usage?: Usage }> {
  if (!response.ok) throw classifyStatus(response.status, await parseErrorBody(response))
  const raw = await response.text().catch(() => '')
  try {
    const json = JSON.parse(raw) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: unknown } }>
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = json?.choices?.[0]?.message?.content
    let text = ''
    if (typeof content === 'string' && content.trim()) text = content
    else if (Array.isArray(content)) {
      const joined = content.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text || '')).join('')
      if (joined.trim()) text = joined
    }
    if (!text) {
      const parts = json?.candidates?.[0]?.content?.parts
      if (parts?.length) text = parts.map((p) => p.text || '').join('')
    }
    if (text.trim()) return { text, usage: usageFromRaw(json.usage) ?? undefined }
  } catch { /* fall through */ }
  throw new AIError('UNREADABLE', 'errors.unreadable', { detail: raw.slice(0, 200) })
}

function guardApiKey(apiKey: string) {
  if (!apiKey.trim()) throw new AIError('NO_KEY', 'errors.noKey')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw timeoutError()
    let host = ''
    try { host = new URL(url).host } catch { /* keep empty */ }
    const msg = e instanceof Error ? e.message : undefined
    throw networkError(host && msg ? `${msg} (${host})` : (msg || (host ? `request to ${host} failed` : undefined)))
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------------------------- Gemini ---------------------------------- */
/* Implemented on the official @google/genai SDK (see ./gemini.ts). The client is
   built per call with the key picked by the key pool; errors are mapped back onto
   the unified AIError taxonomy. */

async function callGemini(args: CallArgs): Promise<CallResult> {
  guardApiKey(args.apiKey)
  const ai = createGeminiClient(args.apiKey, args.timeoutMs ?? TIMEOUT_MS)
  const parts: Part[] = [{ text: args.user }]
  for (const img of args.images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataUrl.split(',')[1] || '' } })
  }
  try {
    const response = await ai.models.generateContent({
      model: args.model.trim(),
      contents: { role: 'user', parts },
      config: geminiJsonConfig({
        system: args.system,
        schema: args.schema,
        maxTokens: args.maxTokens,
        model: args.model,
      }),
    })
    const text = readGeminiResponse(response)
    const usage = usageFromRaw(response.usageMetadata) ?? estimateUsage(args.system, args.user, args.images.length, text)
    return { text, usage }
  } catch (e) {
    throw toGeminiAIError(e)
  }
}

/* ----------------------------- OpenAI-compatible ----------------------------- */

async function callOpenAICompatible(args: CallArgs): Promise<CallResult> {
  guardApiKey(args.apiKey)
  const endpoint = openAIEndpoint(args.type, args.baseURL)
  if (!endpoint) throw new AIError('BAD_REQUEST', 'errors.badRequest', { detail: 'Missing baseURL for custom provider' })
  const content: OpenAIContentPart[] = [{ type: 'text', text: args.user }]
  for (const img of args.images) content.push({ type: 'image_url', image_url: { url: img.dataUrl } })

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${args.apiKey.trim()}` }
  if (args.type === 'openrouter') {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://paper-examiner.pages.dev'
    headers['X-Title'] = 'Paper Examiner'
  }

  const messages = [
    { role: 'system' as const, content: args.system },
    { role: 'user' as const, content },
  ]
  const base = { model: args.model, messages, temperature: 0.15, max_tokens: args.maxTokens }

  // Attempt 1: strict json_schema. Attempt 2: json_object (some providers reject schemas). Attempt 3: plain.
  const attempts: Array<Record<string, unknown>> = [
    { ...base, response_format: { type: 'json_schema', json_schema: { name: args.schemaName, strict: true, schema: args.schema } } },
    { ...base, response_format: { type: 'json_object' } },
    base,
  ]

  let lastError: AIError | null = null
  for (let i = 0; i < attempts.length; i++) {
    let response: Response
    try {
      response = await fetchWithTimeout(endpoint, { method: 'POST', headers, body: JSON.stringify(attempts[i]) }, args.timeoutMs ?? TIMEOUT_MS)
    } catch (e) {
      const err = e instanceof AIError ? e : networkError(String(e))
      if (err.retryable && i < attempts.length - 1) { lastError = err; continue }
      throw err
    }
    if (response.ok) {
      const out = await readContent(response)
      if (out.usage) return out
      // Provider did not report usage — record a marked estimate instead of losing the call.
      return { text: out.text, usage: estimateUsage(args.system, args.user, args.images.length, out.text) }
    }
    const err = classifyStatus(response.status, await parseErrorBody(response))
    // 400 often means "response_format not supported" → fall through to next attempt
    if (err.code === 'BAD_REQUEST' && i < attempts.length - 1) { lastError = err; continue }
    throw err
  }
  throw lastError ?? new AIError('UNKNOWN', 'errors.unknown')
}

/* ------------------------------ Shared-tier proxy ------------------------------ */
/* The browser sends a *semantic* request to our own origin. It never sends a key or an upstream URL;
   the Pages Function (functions/api/ai.ts) picks the key from encrypted env vars. */

const PROXY_ERROR_MAP: Record<ProxyErr['code'], (m: string) => AIError> = {
  BAD_REQUEST: (m) => new AIError('BAD_REQUEST', 'errors.badRequest', { status: 400, detail: m }),
  UPSTREAM_BAD_REQUEST: (m) => new AIError('BAD_REQUEST', 'errors.badRequest', { status: 400, detail: m }),
  PAYLOAD_TOO_LARGE: (m) => new AIError('BAD_REQUEST', 'errors.badRequest', { status: 413, detail: m }),
  BAD_MODEL: (m) => new AIError('BAD_MODEL', 'errors.badModel', { status: 404, detail: m }),
  FORBIDDEN_ORIGIN: (m) => new AIError('FORBIDDEN', 'errors.forbidden', { status: 403, detail: m }),
  TURNSTILE: (m) => new AIError('FORBIDDEN', 'errors.forbidden', { status: 403, detail: m, retryable: false }),
  RATE_LIMITED: (m) => new AIError('RATE_LIMITED', 'errors.rateLimited', { status: 429, detail: m, retryable: true }),
  UPSTREAM_QUOTA: (m) => new AIError('RATE_LIMITED', 'errors.rateLimited', { status: 429, detail: m, retryable: true }),
  // The shared key is unavailable. The user cannot fix that, so don't burn retries — point them at BYOK.
  UPSTREAM_AUTH: (m) => new AIError('NO_KEY', 'errors.noKey', { status: 503, detail: m, retryable: false }),
  NOT_CONFIGURED: (m) => new AIError('NO_KEY', 'errors.noKey', { status: 503, detail: m, retryable: false }),
  UPSTREAM_SERVER: (m) => new AIError('SERVER', 'errors.server', { status: 502, detail: m, retryable: true }),
  UPSTREAM_TIMEOUT: (m) => new AIError('TIMEOUT', 'errors.timeout', { status: 504, detail: m, retryable: true }),
  UPSTREAM_UNREADABLE: (m) => new AIError('UNREADABLE', 'errors.unreadable', { status: 502, detail: m, retryable: true }),
}

function stripDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
}

async function callProxy(args: CallArgs): Promise<CallResult> {
  if (!args.proxy) throw new AIError('BAD_REQUEST', 'errors.badRequest', { detail: 'Missing proxy target' })
  const payload: ProxyRequest = {
    providerId: args.proxy.providerId,
    model: args.model,
    system: args.system,
    user: args.user,
    images: args.images.map((img) => ({ mimeType: img.mimeType, data: stripDataUrl(img.dataUrl) })),
    schemaName: args.schemaName,
    schema: args.schema,
    maxTokens: args.maxTokens,
    turnstileToken: args.proxy.turnstileToken,
  }
  const response = await fetchWithTimeout('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  }, args.timeoutMs ?? TIMEOUT_MS + 15_000)

  let data: ProxyOk | ProxyErr | null = null
  try { data = (await response.json()) as ProxyOk | ProxyErr } catch { /* non-JSON (e.g. platform error page) */ }

  if (data && data.ok === true && typeof data.text === 'string') {
    const usage = usageFromRaw(data.usage) ?? estimateUsage(args.system, args.user, args.images.length, data.text)
    return { text: data.text, usage }
  }
  if (data && data.ok === false && PROXY_ERROR_MAP[data.code]) throw PROXY_ERROR_MAP[data.code](data.message)
  // The endpoint is missing/misconfigured (e.g. `vite dev` without Functions returns index.html or 404).
  throw classifyStatus(response.status || 0, 'The shared AI service is not available. Add your own API key in Settings.')
}

/* ---------------------------------- Router ---------------------------------- */

export async function callModelText(args: CallArgs): Promise<CallResult> {
  if (args.proxy) return callProxy(args)
  if (args.type === 'gemini') return callGemini(args)
  return callOpenAICompatible(args)
}
