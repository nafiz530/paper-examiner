import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PublicConfig, PublicProvider } from '../../shared/aiWire'
import { adminModelRefsFrom, pruneStaleAdminSelection, type ModelRef } from './settings'
import { useSettings } from './SettingsContext'

/**
 * The "Provided for you" catalogue. It comes from the server (GET /api/models) and contains
 * NO keys — only provider ids, labels and model names. If the endpoint is missing (e.g. plain
 * `vite dev` without Pages Functions) the app simply runs in BYOK-only mode.
 */
type State = { loaded: boolean; providers: PublicProvider[]; turnstileSiteKey?: string; models: ModelRef[] }

const Ctx = createContext<State>({ loaded: false, providers: [], models: [] })

export function ServerModelsProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<{ loaded: boolean; providers: PublicProvider[]; turnstileSiteKey?: string }>({ loaded: false, providers: [] })
  const { update } = useSettings()

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/models', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const ct = r.headers.get('Content-Type') || ''
        // In `vite dev` the SPA fallback returns index.html (200, text/html) — treat as "no server".
        if (!r.ok || !ct.includes('application/json')) throw new Error('no proxy')
        const j = (await r.json()) as PublicConfig
        setCfg({ loaded: true, providers: Array.isArray(j.providers) ? j.providers : [], turnstileSiteKey: j.turnstileSiteKey })
      })
      .catch(() => { if (!ctrl.signal.aborted) setCfg({ loaded: true, providers: [] }) })
    return () => ctrl.abort()
  }, [])

  const value = useMemo<State>(() => ({ ...cfg, models: adminModelRefsFrom(cfg.providers) }), [cfg])

  // Once we KNOW what the server offers, forget saved shared-model picks that are no longer offered.
  useEffect(() => {
    if (!cfg.loaded) return
    update((s) => {
      const next = pruneStaleAdminSelection(s.selection, value.models)
      const changed = next.single !== s.selection.single || next.agent.length !== s.selection.agent.length
      return changed ? { ...s, selection: next } : s
    })
  }, [cfg.loaded, value.models, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useServerModels(): State {
  return useContext(Ctx)
}
