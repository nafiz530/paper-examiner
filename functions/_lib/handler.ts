import type { ProxyErr, ProxyOk, PublicConfig } from '../../shared/aiWire'
import { LIMITS, RATE_LIMIT, SERVER_PROVIDERS, type Env, type ServerProvider } from './config'
import { keysFor, providerConfigured, shuffled } from './keys'
import { isAllowedOrigin } from './origin'
import { checkRateLimit, clientId } from './ratelimit'
import { turnstileEnabled, verifyTurnstile } from './turnstile'
import { callUpstream, UpstreamError } from './upstream'
import { validateProxyRequest, ValidationError } from './validate'

/** Headers on every response: never cache, never sniff, no CORS (same-origin only). */
const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function json(body: ProxyOk | ProxyErr | PublicConfig, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } })
}

function err(code: ProxyErr['code'], message: string, status: number, extra: Record<string, string> = {}, retryAfter?: number): Response {
  const body: ProxyErr = { ok: false, code, message, ...(retryAfter ? { retryAfter } : {}) }
  return json(body, status, extra)
}

/** GET /api/models — key-free description of what is offered. */
export function handleModels(request: Request, env: Env, providers: ServerProvider[] = SERVER_PROVIDERS): Response {
  const cfg: PublicConfig = {
    providers: providers
      .filter((p) => providerConfigured(p, env))
      .map((p) => ({ id: p.id, type: p.type as PublicConfig['providers'][number]['type'], label: p.label, models: p.models })),
    turnstileSiteKey: turnstileEnabled(env) ? String(env.TURNSTILE_SITE_KEY) : undefined,
    limits: { maxBodyBytes: LIMITS.maxBodyBytes, maxImages: LIMITS.maxImages, maxTokens: LIMITS.maxTokens },
  }
  void request
  return json(cfg, 200, { 'Cache-Control': 'public, max-age=60' })
}

export type HandlerDeps = { fetchImpl?: typeof fetch; providers?: ServerProvider[]; now?: () => number }

/** POST /api/ai */
export async function handleAI(request: Request, env: Env, deps: HandlerDeps = {}): Promise<Response> {
  const providers = deps.providers ?? SERVER_PROVIDERS
  const fetchImpl = deps.fetchImpl ?? fetch

  // 1. Same-origin gate (before doing any work)
  if (!isAllowedOrigin(request, env)) return err('FORBIDDEN_ORIGIN', 'This endpoint can only be used from the Paper Examiner site.', 403)

  // 2. Content type + declared size, before reading the body
  const ct = request.headers.get('Content-Type') || ''
  if (!/^application\/json\b/i.test(ct)) return err('BAD_REQUEST', 'Content-Type must be application/json.', 415)
  const declared = Number(request.headers.get('Content-Length') || '0')
  if (declared > LIMITS.maxBodyBytes) return err('PAYLOAD_TOO_LARGE', 'Request is too large.', 413)

  // 3. Rate limit per client (counted BEFORE parsing so junk traffic is throttled too)
  const ip = clientId(request)
  const rl = await checkRateLimit(ip, RATE_LIMIT, env.RATE_KV, deps.now?.())
  if (!rl.allowed) return err('RATE_LIMITED', 'Too many requests. Please wait and try again.', 429, { 'Retry-After': String(rl.retryAfter) }, rl.retryAfter)

  // 4. Read the body with a hard cap (Content-Length can lie / be absent)
  let text: string
  try {
    text = await readCapped(request, LIMITS.maxBodyBytes)
  } catch {
    return err('PAYLOAD_TOO_LARGE', 'Request is too large.', 413)
  }
  let body: unknown
  try { body = JSON.parse(text) } catch { return err('BAD_REQUEST', 'Body is not valid JSON.', 400) }

  // 5. Validate + resolve provider/model against the server-side allowlist
  let validated
  try {
    validated = validateProxyRequest(body, providers)
  } catch (e) {
    if (e instanceof ValidationError) return err(e.code, e.message, e.status)
    return err('BAD_REQUEST', 'Invalid request.', 400)
  }
  const { req, provider } = validated

  // 6. Turnstile (fails closed when enabled)
  if (!(await verifyTurnstile(req.turnstileToken, ip, env, fetchImpl))) {
    return err('TURNSTILE', 'Human verification failed. Please refresh and try again.', 403)
  }

  // 7. Keys — only from the encrypted env binding
  const keys = keysFor(provider, env)
  if (keys.length === 0) return err('NOT_CONFIGURED', 'This model is not available right now.', 503)

  // 8. Call upstream, rotating through the pool if a KEY is at fault
  const origin = (() => { try { return new URL(request.url).origin } catch { return 'https://paper-examiner.pages.dev' } })()
  let lastErr: UpstreamError | null = null
  for (const key of shuffled(keys).slice(0, 4)) {
    try {
      const out = await callUpstream(provider, req, key, origin, fetchImpl)
      return json({ ok: true, text: out })
    } catch (e) {
      if (e instanceof UpstreamError) {
        lastErr = e
        if (e.rotateKey) continue   // this key is dead/limited → try the next one
        return json(e.toWire(), e.httpStatus)
      }
      return err('UPSTREAM_SERVER', 'Unexpected error while contacting the AI provider.', 502)
    }
  }
  // every key tried was at fault
  const e = lastErr ?? new UpstreamError('UPSTREAM_SERVER', 'The AI provider had a temporary problem.', 502)
  return json(e.toWire(), e.httpStatus, e.code === 'UPSTREAM_QUOTA' ? { 'Retry-After': '30' } : {})
}

/** Read a request body as text but abort once it exceeds `max` bytes. */
async function readCapped(request: Request, max: number): Promise<string> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { try { await reader.cancel() } catch { /* ignore */ } throw new Error('too large') }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { merged.set(c, off); off += c.byteLength }
  return new TextDecoder().decode(merged)
}

export { keysFor }
