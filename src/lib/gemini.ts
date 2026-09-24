/**
 * Google Gemini via the official @google/genai SDK (browser + Node compatible).
 *
 * Why this replaces the old hand-rolled REST calls:
 *  - Correct request/response shapes maintained by Google (no silent 400s when the
 *    REST surface changes).
 *  - Real error bodies, promptFeedback.blockReason and candidate finishReason are
 *    surfaced instead of generic "unreadable" failures.
 *  - Built-in timeout + abort handling.
 *
 * NOTE: this app is a client-side SPA. API keys come from the key pool in
 * settings.ts at call time (keys rotate), so the client is created per call —
 * do NOT use process.env/dotenv here (that is Node-only).
 */
import { GoogleGenAI, type GenerateContentResponse, type GenerateContentConfig, type SafetySetting, type Schema } from '@google/genai'
import { AIError, classifyStatus, timeoutError, networkError } from './aiErrors'

export const DEFAULT_GEMINI_TIMEOUT_MS = 90_000

export function createGeminiClient(apiKey: string, timeoutMs?: number): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: { timeout: timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS },
  })
}

/**
 * Gemini 3.x models reject the legacy sampling parameters (temperature / topP /
 * topK are deprecated since the 3.5/3.6 generation — sending them returns 400).
 * Only attach them for 1.5/2.x models.
 */
export function supportsLegacySampling(model: string): boolean {
  return /^gemini-(1\.5|2\.)/.test(model.trim())
}

/**
 * Relaxed safety thresholds. Exam material (biology diagrams, history, medicine…)
 * routinely trips Gemini's default filters, which surfaces as an empty response.
 * BLOCK_ONLY_HIGH keeps obvious abuse blocked while letting exam content through.
 */
export const GEMINI_SAFETY_SETTINGS: SafetySetting[] = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category: category as SafetySetting['category'], threshold: 'BLOCK_ONLY_HIGH' as const }))

/**
 * Map any SDK failure onto the unified AIError taxonomy so the key pool,
 * retry logic and i18n messages keep working unchanged.
 * SDK API errors look like: "[429 Too Many Requests] { ...error body... }"
 */
export function toGeminiAIError(e: unknown): AIError {
  if (e instanceof AIError) return e
  if (e instanceof DOMException && e.name === 'AbortError') return timeoutError()
  const msg = (e instanceof Error ? e.message : String(e)) || 'Unknown Gemini SDK error'
  const capped = msg.slice(0, 300)

  const statusMatch = msg.match(/\[(\d{3})[\s\]]/) ?? msg.match(/\b(400|401|402|403|404|408|413|429|500|502|503|504)\b/)
  if (statusMatch) return classifyStatus(Number(statusMatch[1]), capped)
  if (/location is not supported|failed_precondition/i.test(msg)) return classifyStatus(400, capped)
  if (/api[- ]?key not valid|invalid api key/i.test(msg)) {
    return new AIError('UNAUTHORIZED', 'errors.unauthorized', { detail: capped })
  }
  if (/quota|rate limit|too many requests|resource exhausted/i.test(msg)) {
    return new AIError('RATE_LIMITED', 'errors.rateLimited', { detail: capped, retryable: true })
  }
  if (/model .*not (found|supported)|does not exist|no such model/i.test(msg)) {
    return new AIError('BAD_MODEL', 'errors.badModel', { detail: capped })
  }
  if (/timed? ?out|deadline exceeded|abort/i.test(msg)) return timeoutError()
  if (/failed to fetch|networkerror|fetch failed|load failed|err_network|err_internet/i.test(msg)) {
    return networkError(capped)
  }
  return new AIError('UNKNOWN', 'errors.unknown', { detail: capped })
}

/**
 * Extract text from a GenerateContentResponse, translating silent Gemini
 * failure modes (safety block, truncation, empty candidate) into AIErrors.
 */
export function readGeminiResponse(response: GenerateContentResponse): string {
  const blockReason = response.promptFeedback?.blockReason
  if (blockReason) {
    throw new AIError('FORBIDDEN', 'errors.forbidden', {
      detail: `Gemini safety filter blocked the request (${blockReason}). Try a different model or rephrase.`,
      retryable: false,
    })
  }
  const candidate = response.candidates?.[0]
  const finishReason = candidate?.finishReason
  const text = (candidate?.content?.parts ?? []).map((p) => p.text || '').join('')
  if (text.trim()) {
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
      // Truncated JSON is poison — let the retry machinery re-run with more headroom.
      throw new AIError('UNREADABLE', 'errors.unreadable', {
        detail: `Output truncated by Gemini (${finishReason}) — retrying with more token headroom.`,
        retryable: true,
      })
    }
    return text
  }
  throw new AIError('UNREADABLE', 'errors.unreadable', {
    detail: finishReason ? `Gemini returned an empty candidate (finishReason: ${finishReason}).` : 'Gemini returned an empty response.',
    retryable: true,
  })
}

/** Build the standard generation config for one pipeline call. */
export function geminiJsonConfig(args: {
  system: string
  schema: Record<string, unknown>
  maxTokens: number
  model: string
}): GenerateContentConfig {
  return {
    systemInstruction: args.system,
    maxOutputTokens: args.maxTokens,
    responseMimeType: 'application/json',
    responseSchema: args.schema as unknown as Schema,
    safetySettings: GEMINI_SAFETY_SETTINGS,
    // temperature is deprecated on Gemini 3.x models — only send it to 1.5/2.x
    ...(supportsLegacySampling(args.model) ? { temperature: 0.15 } : {}),
  }
}
