import type { Env } from './config'

/**
 * Turnstile is OFF unless explicitly opted in with TURNSTILE_ENFORCE=1 *and* both keys are set.
 *
 * Why the extra flag: the server fails CLOSED when Turnstile is on, so enforcing it before the browser
 * can obtain and send a token would lock every user out. The SPA does not ship a Turnstile widget yet
 * (it needs CSP changes: script-src, frame-src and connect-src for challenges.cloudflare.com),
 * so merely setting the two keys must never brick the site.
 */
export function turnstileEnabled(env: Env): boolean {
  return env.TURNSTILE_ENFORCE === '1' && !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET)
}

/** Verify a Turnstile token server-side. Fails CLOSED when enabled and the token is missing/invalid. */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!turnstileEnabled(env)) return true
  if (!token) return false
  try {
    const form = new URLSearchParams()
    form.set('secret', String(env.TURNSTILE_SECRET))
    form.set('response', token)
    if (ip && ip !== 'unknown') form.set('remoteip', ip)
    const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const data = (await r.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
