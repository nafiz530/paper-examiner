import type { Env } from './config'

/**
 * Same-origin gate. This is a speed bump against casual cross-site abuse and drive-by
 * browser calls — it is NOT authentication (non-browser clients can forge Origin).
 * Real abuse resistance comes from the rate limiter, size caps, model allowlist and Turnstile.
 *
 * Allowed when the request's Origin matches the deployment's own origin, or is listed in ALLOWED_ORIGINS.
 * Requests with no Origin header (curl, server-to-server) are REJECTED — a browser always sends one on POST.
 */
export function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  let selfOrigin = ''
  try { selfOrigin = new URL(request.url).origin } catch { /* ignore */ }
  if (origin === selfOrigin) return true
  const extra = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return extra.includes(origin)
}
