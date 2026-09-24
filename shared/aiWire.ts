/**
 * Wire contract between the browser and the /api/ai proxy.
 *
 * Imported by BOTH the SPA (src/) and the Cloudflare Pages Function (functions/).
 * Keep it dependency-free and free of any DOM / Workers-specific types.
 *
 * The browser NEVER sends an upstream URL, an API key, or a raw provider payload.
 * It sends a semantic request; the server decides where it goes and with which key.
 */

/** Providers the proxy can front. `custom` is deliberately NOT proxyable (SSRF risk). */
export type ProxyProviderType = 'gemini' | 'openai' | 'openrouter' | 'groq' | 'mistral'

export type WireImage = { mimeType: string; data: string } // data = base64, NO "data:" prefix

export type ProxyRequest = {
  /** id of a server-side provider entry, e.g. "gemini-free" */
  providerId: string
  model: string
  system: string
  user: string
  images: WireImage[]
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  /** Cloudflare Turnstile token, when Turnstile is enabled server-side */
  turnstileToken?: string
}

/** Public, key-free description of what the server offers. Served by GET /api/ai/models. */
export type PublicProvider = {
  id: string
  type: ProxyProviderType
  label: string
  models: string[]
}

export type PublicConfig = {
  providers: PublicProvider[]
  /** Server-enforced per-IP daily cap on "Provided for you" exams (informational for the UI). */
  turnstileSiteKey?: string
  limits: { maxBodyBytes: number; maxImages: number; maxTokens: number }
}

/** Success body is the provider-agnostic text the model produced. */
export type ProxyOk = { ok: true; text: string }

export type ProxyErrorCode =
  | 'BAD_REQUEST' | 'BAD_MODEL' | 'FORBIDDEN_ORIGIN' | 'TURNSTILE'
  | 'RATE_LIMITED' | 'PAYLOAD_TOO_LARGE' | 'NOT_CONFIGURED'
  | 'UPSTREAM_AUTH' | 'UPSTREAM_QUOTA' | 'UPSTREAM_SERVER' | 'UPSTREAM_BAD_REQUEST' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_UNREADABLE'

export type ProxyErr = {
  ok: false
  code: ProxyErrorCode
  message: string
  /** seconds, present for RATE_LIMITED */
  retryAfter?: number
}
