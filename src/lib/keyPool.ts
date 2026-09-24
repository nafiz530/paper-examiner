import { AIError, toAIError } from './aiErrors'
import { keyFp, loadSettings, saveSettings, type KeyHealth, type ModelRef } from './settings'

/**
 * Key pool: rotates through a model's keys, cools down keys that hit 429/quota,
 * permanently (24h) benches keys that answer 401/403, and persists health so a
 * dead admin key is skipped after reload too (recovers automatically after 24h
 * or when the admin replaces the key in the config file).
 */

const COOLDOWN_MS = 60_000
const DEAD_MS = 24 * 60 * 60 * 1000

type Entry = { key: string; fp: string; cooldownUntil: number; dead: boolean }

export class KeyPool {
  private entries: Entry[]
  private cursor = 0
  private model: ModelRef

  constructor(model: ModelRef) {
    this.model = model
    const health = loadSettings().keyHealth
    const now = Date.now()
    this.entries = model.keys.map((key) => {
      const fp = keyFp(model.source, model.providerId, key)
      const h = health[fp]
      const dead = h?.state === 'dead' ? now - h.at < DEAD_MS : false
      const cooldownUntil = h?.state === 'cooldown' && h.until > now ? h.until : 0
      return { key: key.trim(), fp, cooldownUntil, dead }
    })
  }

  get availableCount(): number {
    const now = Date.now()
    return this.entries.filter((e) => !e.dead && e.cooldownUntil <= now).length
  }

  /** Next usable key, round-robin. Throws a pooled AIError when everything is benched. */
  pick(): { key: string; fp: string } {
    const now = Date.now()
    const n = this.entries.length
    for (let i = 0; i < n; i++) {
      const e = this.entries[(this.cursor + i) % n]
      if (!e.dead && e.cooldownUntil <= now) {
        this.cursor = (this.cursor + i + 1) % n
        return { key: e.key, fp: e.fp }
      }
    }
    // all benched — find the soonest recovery
    const alive = this.entries.filter((e) => !e.dead)
    if (alive.length === 0) {
      throw new AIError('NO_KEY', 'errors.noKey', { detail: 'All keys for this model were rejected (401/403).' })
    }
    const soonest = Math.min(...alive.map((e) => e.cooldownUntil))
    const wait = Math.max(0, soonest - now)
    throw new AIError('RATE_LIMITED', 'errors.rateLimited', { detail: `All keys cooling down — retry in ${Math.ceil(wait / 1000)}s`, retryable: true })
  }

  /** Report the outcome of using a key so health stays accurate. */
  report(fp: string, error: AIError) {
    const entry = this.entries.find((e) => e.fp === fp)
    if (!entry) return
    if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
      entry.dead = true
      persistHealth(entry.fp, { state: 'dead', at: Date.now() })
    } else if (error.code === 'RATE_LIMITED' || error.code === 'QUOTA') {
      entry.cooldownUntil = Date.now() + COOLDOWN_MS
      persistHealth(entry.fp, { state: 'cooldown', until: entry.cooldownUntil })
    }
  }
}

function persistHealth(fp: string, state: KeyHealth[string]) {
  try {
    const s = loadSettings()
    s.keyHealth[fp] = state
    // keep the map from growing forever
    if (Object.keys(s.keyHealth).length > 200) s.keyHealth = {}
    saveSettings(s)
  } catch { /* non fatal */ }
}

/** Run one call with automatic key rotation + bounded retries according to the error matrix. */
export async function withKeyRotation<T>(model: ModelRef, fn: (apiKey: string) => Promise<T>): Promise<T> {
  const pool = new KeyPool(model)
  const maxAttempts = 4
  let lastError: AIError | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let fp: string
    try {
      const picked = pool.pick()
      fp = picked.fp
    } catch (e) {
      throw toAIError(e)
    }
    try {
      return await fn(model.keys.find((k) => keyFp(model.source, model.providerId, k) === fp) ?? model.keys[0])
    } catch (e) {
      const err = toAIError(e)
      pool.report(fp, err)
      lastError = err
      if (!err.retryable) throw err
      const backoff = err.code === 'RATE_LIMITED' ? Math.min(8000, 2000 * 2 ** attempt) : 1500
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastError ?? new AIError('UNKNOWN', 'errors.unknown')
}
