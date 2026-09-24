import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { loadSettings, saveSettings, type Settings } from './settings'

type Ctx = { settings: Settings; update: (fn: (s: Settings) => Settings) => void; reload: () => void }

const SettingsCtx = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const update = useCallback((fn: (s: Settings) => Settings) => {
    setSettings((prev) => {
      const next = fn(prev)
      saveSettings(next)
      return next
    })
  }, [])
  const reload = useCallback(() => setSettings(loadSettings()), [])
  const value = useMemo(() => ({ settings, update, reload }), [settings, update, reload])
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsCtx)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
