import type { KVNamespaceLike } from './config'

/**
 * Fixed-window per-key counter.
 *
 * - With a KV namespace bound (RATE_KV) the count is shared across the edge (eventually
 *   consistent — good enough for abuse control, not for billing-grade accuracy).
 * - Without KV it falls back to an in-memory Map that is per-isolate: it still stops a single
 *   hot client but is NOT a global guarantee. Pair with a WAF rate-limiting rule on /api/*.
 */
const memory = new Map<string, { count: number; resetAt: number }>()

export type RateResult = { allowed: boolean; remaining: number; retryAfter: number }

export async function checkRateLimit(
  key: string,
  opts: { maxCalls: number; windowSec: number },
  kv?: KVNamespaceLike,
  now: number = Date.now(),
): Promise<RateResult> {
  const window = Math.floor(now / 1000 / opts.windowSec)
  const bucket = `rl:${key}:${window}`
  const resetAtMs = (window + 1) * opts.windowSec * 1000
  const retryAfter = Math.max(1, Math.ceil((resetAtMs - now) / 1000))

  if (kv) {
    let count = 0
    try { count = parseInt((await kv.get(bucket)) ?? '0', 10) || 0 } catch { /* fail open on KV error */ }
    if (count >= opts.maxCalls) return { allowed: false, remaining: 0, retryAfter }
    try { await kv.put(bucket, String(count + 1), { expirationTtl: opts.windowSec + 60 }) } catch { /* non fatal */ }
    return { allowed: true, remaining: opts.maxCalls - count - 1, retryAfter }
  }

  // in-memory fallback
  if (memory.size > 5000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k)
    if (memory.size > 5000) memory.clear()
  }
  const cur = memory.get(bucket)
  const entry = cur && cur.resetAt > now ? cur : { count: 0, resetAt: resetAtMs }
  if (entry.count >= opts.maxCalls) { memory.set(bucket, entry); return { allowed: false, remaining: 0, retryAfter } }
  entry.count += 1
  memory.set(bucket, entry)
  return { allowed: true, remaining: opts.maxCalls - entry.count, retryAfter }
}

/** Test helper. */
export function _resetRateLimitMemory() { memory.clear() }

/** Best client identifier available on Cloudflare. */
export function clientId(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
}
