import type { AdminProvider, ProviderType } from '../config/examiner.config'
import { ADMIN_PROVIDERS } from '../config/examiner.config'

/** A concrete, runnable model reference resolved from admin config or user settings. */
export type ModelRef = {
  source: 'admin' | 'user'
  providerId: string
  providerLabel: string
  type: ProviderType
  /** full base URL for 'custom', undefined otherwise */
  baseURL?: string
  model: string
  /** the concrete key to try first; the pool may rotate through the others */
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

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<Settings>
    const s = defaultSettings()
    return {
      userProviders: Array.isArray(parsed.userProviders) ? parsed.userProviders : [],
      selection: parsed.selection && typeof parsed.selection === 'object'
        ? { mode: parsed.selection.mode === 'agent' ? 'agent' : 'single', single: parsed.selection.single ?? null, agent: Array.isArray(parsed.selection.agent) ? parsed.selection.agent : [] }
        : s.selection,
      keyHealth: parsed.keyHealth && typeof parsed.keyHealth === 'object' ? parsed.keyHealth : {},
      lastRunDate: typeof parsed.lastRunDate === 'string' ? parsed.lastRunDate : '',
      runsToday: typeof parsed.runsToday === 'number' ? parsed.runsToday : 0,
    }
  } catch {
    return defaultSettings()
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

export function providerHasRealKeys(p: AdminProvider | UserProviderEntry): boolean {
  return p.keys.some((k) => k.trim() && !looksPlaceholder(k))
}

/** All models offered by admin config (enabled providers with at least one real key). */
export function adminModelRefs(): ModelRef[] {
  const out: ModelRef[] = []
  for (const p of ADMIN_PROVIDERS as AdminProvider[]) {
    if (!p.enabled) continue
    const keys = p.keys.filter((k) => k.trim() && !looksPlaceholder(k))
    if (keys.length === 0) continue
    for (const model of p.models) {
      if (!model.trim()) continue
      out.push({ source: 'admin', providerId: p.id, providerLabel: p.label, type: p.type, baseURL: p.baseURL, model: model.trim(), keys })
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

export function allAvailableModels(userProviders: UserProviderEntry[]): { free: ModelRef[]; yours: ModelRef[] } {
  return { free: adminModelRefs(), yours: userModelRefs(userProviders) }
}
