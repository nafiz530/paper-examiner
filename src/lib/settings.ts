import type { ProviderType } from '../config/examiner.config'
import type { PublicProvider } from '../../shared/aiWire'

/** A concrete, runnable model reference resolved from admin config or user settings. */
export type ModelRef = {
  source: 'admin' | 'user'
  providerId: string
  providerLabel: string
  type: ProviderType
  /** full base URL for 'custom', undefined otherwise */
  baseURL?: string
  model: string
  /**
   * BYOK keys (source 'user' ONLY). For source 'admin' this is ALWAYS empty: the shared keys live on the
   * server and are never sent to, stored in, or bundled with the browser.
   */
  keys: string[]
}

export type UserProviderEntry = {
  id: string
  type: ProviderType
  label: string
  baseURL?: string
  keys: string[]
  models: string[]
}

export type RunMode = 'single' | 'agent'

export type Selection = {
  mode: RunMode
  /** used in single mode */
  single?: ModelRef | null
  /** used in agent mode (reviewers round-robin across these) */
  agent: ModelRef[]
}

export type KeyHealthState = { state: 'dead'; at: number } | { state: 'cooldown'; until: number }
export type KeyHealth = Record<string, KeyHealthState>

export type Settings = {
  userProviders: UserProviderEntry[]
  selection: Selection
  keyHealth: KeyHealth
  lastRunDate: string
  runsToday: number
}

const SETTINGS_KEY = 'paper-examiner-settings-v2'

export function defaultSettings(): Settings {
  return { userProviders: [], selection: { mode: 'single', single: null, agent: [] }, keyHealth: {}, lastRunDate: '', runsToday: 0 }
}

/**
 * Older builds saved the whole ModelRef in localStorage — for shared ("admin") models that INCLUDED the
 * shared API keys that were bundled into the site. Scrub them on every load so no browser keeps a copy,
 * whatever state it was left in. Shared models never carry keys (they are resolved server-side).
 */
function scrubModelRef(m: unknown): ModelRef | null {
  if (!m || typeof m !== 'object') return null
  const r = m as Partial<ModelRef>
  if (typeof r.providerId !== 'string' || typeof r.model !== 'string' || typeof r.type !== 'string') return null
  const source = r.source === 'admin' ? 'admin' : 'user'
  return {
    source,
    providerId: r.providerId,
    providerLabel: typeof r.providerLabel === 'string' ? r.providerLabel : r.providerId,
    type: r.type as ProviderType,
    baseURL: typeof r.baseURL === 'string' ? r.baseURL : undefined,
    model: r.model,
    keys: source === 'admin' ? [] : Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === 'string') : [],
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<Settings>
    const s = defaultSettings()
    const sel = parsed.selection && typeof parsed.selection === 'object' ? parsed.selection : null
    const settings: Settings = {
      userProviders: Array.isArray(parsed.userProviders) ? parsed.userProviders : [],
      selection: sel
        ? {
            mode: sel.mode === 'agent' ? 'agent' : 'single',
            single: scrubModelRef(sel.single),
            agent: Array.isArray(sel.agent) ? sel.agent.map(scrubModelRef).filter((m): m is ModelRef => m !== null) : [],
          }
        : s.selection,
      // health entries for shared keys are meaningless now (rotation is server-side) — drop them
      keyHealth: parsed.keyHealth && typeof parsed.keyHealth === 'object'
        ? Object.fromEntries(Object.entries(parsed.keyHealth).filter(([fp]) => !fp.startsWith('admin:')))
        : {},
      lastRunDate: typeof parsed.lastRunDate === 'string' ? parsed.lastRunDate : '',
      runsToday: typeof parsed.runsToday === 'number' ? parsed.runsToday : 0,
    }
    // If the stored blob still contained shared keys, rewrite it clean right away.
    if (/"source":"admin"[^}]*"keys":\[\s*"/.test(raw)) saveSettings(settings)
    return settings
  } catch {
    return defaultSettings()
  }
}

/**
 * Drop saved shared-model selections that the server no longer offers (e.g. a retired model id or a
 * provider whose secret was removed). Without this a returning user gets a confusing 404/BAD_MODEL.
 */
export function pruneStaleAdminSelection(sel: Selection, offered: ModelRef[]): Selection {
  const has = (m: ModelRef) => offered.some((o) => o.providerId === m.providerId && o.model === m.model)
  const keep = (m: ModelRef) => m.source !== 'admin' || has(m)
  return {
    ...sel,
    single: sel.single && keep(sel.single) ? sel.single : null,
    agent: sel.agent.filter(keep),
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* storage full — non fatal */ }
}

/** A key fingerprint used for health tracking (never store the raw key). */
export function keyFp(source: 'admin' | 'user', providerId: string, key: string): string {
  let hash = 5381
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0
  return `${source}:${providerId}:${hash.toString(36)}`
}

const PLACEHOLDER = /PASTE_|YOUR_.*_KEY|xxxx/i
export function looksPlaceholder(key: string): boolean {
  return key.trim().length < 20 || PLACEHOLDER.test(key)
}

/**
 * Convert the server's key-free provider list (GET /api/models) into selectable "Provided for you" models.
 * `keys` is intentionally empty — the browser never holds these credentials.
 */
export function adminModelRefsFrom(providers: PublicProvider[]): ModelRef[] {
  const out: ModelRef[] = []
  for (const p of providers) {
    for (const model of p.models) {
      if (!model.trim()) continue
      out.push({ source: 'admin', providerId: p.id, providerLabel: p.label, type: p.type, model: model.trim(), keys: [] })
    }
  }
  return out
}

/** All models the user configured personally (independent of admin key validity). */
export function userModelRefs(userProviders: UserProviderEntry[]): ModelRef[] {
  const out: ModelRef[] = []
  for (const p of userProviders) {
    const keys = p.keys.filter((k) => k.trim())
    if (keys.length === 0) continue
    for (const model of p.models) {
      if (!model.trim()) continue
      out.push({ source: 'user', providerId: p.id, providerLabel: p.label || p.type, type: p.type, baseURL: p.baseURL, model: model.trim(), keys })
    }
  }
  return out
}

export function allAvailableModels(userProviders: UserProviderEntry[], serverProviders: PublicProvider[]): { free: ModelRef[]; yours: ModelRef[] } {
  return { free: adminModelRefsFrom(serverProviders), yours: userModelRefs(userProviders) }
}
