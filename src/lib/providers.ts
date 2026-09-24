import type { ProviderType } from '../config/examiner.config'
import { AIError, classifyStatus, networkError, timeoutError } from './aiErrors'
import { createGeminiClient, geminiJsonConfig, readGeminiResponse, toGeminiAIError } from './gemini'
import type { Part } from '@google/genai'

export type ImagePart = { mimeType: string; dataUrl: string }

export type CallArgs = {
  type: ProviderType
  baseURL?: string
  model: string
  apiKey: string
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

async function readContent(response: Response): Promise<string> {
  if (!response.ok) throw classifyStatus(response.status, await parseErrorBody(response))
  const raw = await response.text().catch(() => '')
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = json?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) return content
    if (Array.isArray(content)) {
      const joined = content.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text || '')).join('')
      if (joined.trim()) return joined
    }
    const parts = json?.candidates?.[0]?.content?.parts
    if (parts?.length) {
      const joined = parts.map((p) => p.text || '').join('')
      if (joined.trim()) return joined
    }
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

async function callGemini(args: CallArgs): Promise<string> {
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
    return readGeminiResponse(response)
  } catch (e) {
    throw toGeminiAIError(e)
  }
}

/* ----------------------------- OpenAI-compatible ----------------------------- */

async function callOpenAICompatible(args: CallArgs): Promise<string> {
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
    if (response.ok) return readContent(response)
    const err = classifyStatus(response.status, await parseErrorBody(response))
    // 400 often means "response_format not supported" → fall through to next attempt
    if (err.code === 'BAD_REQUEST' && i < attempts.length - 1) { lastError = err; continue }
    throw err
  }
  throw lastError ?? new AIError('UNKNOWN', 'errors.unknown')
}

/* ---------------------------------- Router ---------------------------------- */

export async function callModelText(args: CallArgs): Promise<string> {
  if (args.type === 'gemini') return callGemini(args)
  return callOpenAICompatible(args)
}
