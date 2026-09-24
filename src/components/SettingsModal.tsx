import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleCheck, KeyRound, Plus, Trash2, X } from 'lucide-react'
import type { ProviderType } from '../config/examiner.config'
import { AIError, classifyStatus } from '../lib/aiErrors'
import type { ModelRef, RunMode, UserProviderEntry } from '../lib/settings'
import { useServerModels } from '../lib/serverModels'
import { useSettings } from '../lib/SettingsContext'
import { useI18n } from '../i18n'
import { callModelText } from '../lib/providers'
import { proxyTarget } from '../lib/pipeline'

const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
]

function modelKey(m: ModelRef): string {
  return `${m.source}:${m.providerId}:${m.model}`
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'keys' | 'models'>('keys')
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        className="modal modal--settings"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
      >
        <div className="modal__head">
          <div>
            <div className="eyebrow">{t('settings.title')}</div>
            <h3>{t('settings.subtitle')}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </div>
        <div className="tab-row">
          <button className={'tab ' + (tab === 'keys' ? 'is-active' : '')} onClick={() => setTab('keys')}><KeyRound size={15} /> {t('settings.tab.keys')}</button>
          <button className={'tab ' + (tab === 'models' ? 'is-active' : '')} onClick={() => setTab('models')}>{t('settings.tab.models')}</button>
        </div>
        <AnimatePresence mode="wait">
          {tab === 'keys'
            ? <motion.div key="keys" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }}><KeysTab /></motion.div>
            : <motion.div key="models" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.15 }}><ModelsTab /></motion.div>}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

/* --------------------------------- Keys tab --------------------------------- */

function KeysTab() {
  const { t } = useI18n()
  const { settings, update } = useSettings()
  const [type, setType] = useState<ProviderType>('gemini')
  const [label, setLabel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [keysText, setKeysText] = useState('')
  const [modelsText, setModelsText] = useState('')

  const add = () => {
    const keys = keysText.split('\n').map((k) => k.trim()).filter(Boolean)
    const models = modelsText.split('\n').map((m) => m.trim()).filter(Boolean)
    if (keys.length === 0 || models.length === 0) return
    const entry: UserProviderEntry = {
      id: `user-${Date.now().toString(36)}`,
      type,
      label: label.trim() || PROVIDER_OPTIONS.find((p) => p.value === type)!.label,
      baseURL: type === 'custom' ? baseURL.trim() || undefined : undefined,
      keys,
      models,
    }
    update((s) => ({ ...s, userProviders: [...s.userProviders, entry] }))
    setLabel(''); setKeysText(''); setModelsText(''); setBaseURL('')
  }

  const remove = (id: string) => update((s) => ({ ...s, userProviders: s.userProviders.filter((p) => p.id !== id) }))

  return (
    <div className="keys-tab">
      <p className="settings-intro">{t('settings.keys.intro')}</p>
      <div className="field-grid">
        <div className="field"><label>{t('settings.keys.provider')}</label>
          <select value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
            {PROVIDER_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div className="field"><label>{t('settings.keys.label')} <span className="muted">({t('common.optional')})</span></label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My free Gemini keys" />
        </div>
        {type === 'custom' && (
          <div className="field field--wide"><label>{t('settings.keys.customBase')}</label>
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com/v1" spellCheck={false} />
          </div>
        )}
        <div className="field"><label>{t('settings.keys.paste')}</label>
          <textarea value={keysText} onChange={(e) => setKeysText(e.target.value)} rows={3} placeholder={'AIzaSy…\nAIzaSy…'} spellCheck={false} />
        </div>
        <div className="field"><label>{t('settings.keys.models')}</label>
          <textarea value={modelsText} onChange={(e) => setModelsText(e.target.value)} rows={3} placeholder={'gemini-2.5-flash\ngemini-2.0-flash'} spellCheck={false} />
        </div>
      </div>
      <div className="row-end">
        <button className="button button--primary" onClick={add} disabled={!keysText.trim() || !modelsText.trim()}><Plus size={15} /> {t('settings.keys.add')}</button>
      </div>

      <h4 className="subhead">{t('settings.keys.yours')}</h4>
      {settings.userProviders.length === 0 && <p className="empty-note">{t('settings.keys.empty')}</p>}
      <div className="provider-list">
        {settings.userProviders.map((p) => (
          <div className="provider-card" key={p.id}>
            <div className="provider-card__head">
              <strong>{p.label}</strong>
              <span className="badge">{PROVIDER_OPTIONS.find((x) => x.value === p.type)?.label ?? p.type}</span>
              <button className="danger-link" onClick={() => remove(p.id)}><Trash2 size={13} /> {t('settings.keys.remove')}</button>
            </div>
            <div className="key-chips">
              {p.keys.map((k, i) => <span className="key-chip" key={i}><KeyRound size={12} /> {maskKey(k)}</span>)}
            </div>
            <div className="model-chips">{p.models.map((m) => <span className="model-chip" key={m}>{m}</span>)}</div>
          </div>
        ))}
      </div>

      <AdminKeyStatus />
    </div>
  )
}

function maskKey(k: string): string {
  if (k.length <= 10) return '••••'
  return `${k.slice(0, 5)}••••${k.slice(-3)}`
}

function AdminKeyStatus() {
  const { t } = useI18n()
  const server = useServerModels()
  if (!server.loaded || server.providers.length === 0) return null
  return (
    <div className="notice notice--ok">
      <CircleCheck size={15} />
      <span>{`${t('models.free')}: ${server.providers.map((p) => p.label).join(', ')}`}</span>
    </div>
  )
}

/* -------------------------------- Models tab -------------------------------- */

function ModelsTab() {
  const { t } = useI18n()
  const { settings, update } = useSettings()
  const server = useServerModels()
  const available = useMemo(() => ({
    free: server.models,
    yours: (() => {
      const out: ModelRef[] = []
      for (const p of settings.userProviders) {
        const keys = p.keys.filter((k) => k.trim())
        if (!keys.length) continue
        for (const model of p.models) out.push({ source: 'user' as const, providerId: p.id, providerLabel: p.label, type: p.type, baseURL: p.baseURL, model: model.trim(), keys })
      }
      return out
    })(),
  }), [server.models, settings.userProviders])
  const max = 3

  const toggle = (m: ModelRef) => {
    update((s) => {
      if (s.selection.mode === 'single') {
        return { ...s, selection: { ...s.selection, single: modelKey(s.selection.single ?? ({} as ModelRef)) === modelKey(m) ? null : m } }
      }
      const exists = s.selection.agent.some((x) => modelKey(x) === modelKey(m))
      let agent = exists
        ? s.selection.agent.filter((x) => modelKey(x) !== modelKey(m))
        : [...s.selection.agent, m].slice(0, max)
      return { ...s, selection: { ...s.selection, agent } }
    })
  }

  const setMode = (mode: RunMode) => update((s) => ({ ...s, selection: { ...s.selection, mode } }))

  const selectedKeys = new Set<string>(
    settings.selection.mode === 'single'
      ? (settings.selection.single ? [modelKey(settings.selection.single)] : [])
      : settings.selection.agent.map(modelKey),
  )

  const group = (title: string, models: ModelRef[], badge?: string) => (
    <div className="model-group">
      <div className="model-group__head"><h4>{title}</h4>{badge && <span className="badge badge--accent">{badge}</span>}</div>
      {models.length === 0 && <p className="empty-note">{t('models.none.desc')}</p>}
      <div className="model-list">
        {models.map((m) => {
          const active = selectedKeys.has(modelKey(m))
          const isRadio = settings.selection.mode === 'single'
          return (
            <button key={modelKey(m)} className={'model-row ' + (active ? 'is-active' : '')} onClick={() => toggle(m)} role={isRadio ? 'radio' : 'checkbox'} aria-checked={active}>
              <span className={'check-dot ' + (active ? 'on' : '')}>{active && <Check size={12} />}</span>
              <span className="model-row__name">{m.model}</span>
              <span className="model-row__provider">{m.providerLabel}</span>
              <span className="badge badge--soft">{m.source === 'admin' ? t('models.usesAdminKey') : t('models.usesYourKey')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="models-tab">
      <div className="mode-switch" role="tablist">
        <button className={'mode-btn ' + (settings.selection.mode === 'single' ? 'is-active' : '')} onClick={() => setMode('single')}>
          <strong>{t('models.mode.single')}</strong><span>{t('models.mode.singleDesc')}</span>
        </button>
        <button className={'mode-btn ' + (settings.selection.mode === 'agent' ? 'is-active' : '')} onClick={() => setMode('agent')}>
          <strong>{t('models.mode.agent')}</strong><span>{t('models.mode.agentDesc')}</span>
        </button>
      </div>
      <p className="settings-intro">
        {settings.selection.mode === 'single' ? t('models.pickSingle') : t('models.pickAgent', { max })}
        {settings.selection.mode === 'agent' && selectedKeys.size > 0 && ` · ${t('models.selectedCount', { n: selectedKeys.size })}`}
      </p>
      {group(t('models.free'), available.free, available.free.length ? t('models.freeBadge') : undefined)}
      {group(t('models.yours'), available.yours)}
      <TestSelection />
    </div>
  )
}

function TestSelection() {
  const { settings } = useSettings()
  const { t } = useI18n()
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; msg?: string }>({ busy: false })

  const test = async () => {
    const model = settings.selection.mode === 'single' ? settings.selection.single : settings.selection.agent[0]
    if (!model) return
    setState({ busy: true })
    try {
      await callModelText({
        type: model.type, baseURL: model.baseURL, model: model.model, apiKey: model.keys[0] ?? '', proxy: proxyTarget(model),
        system: 'You are a connection tester.', user: 'Reply with exactly: CONNECTION_OK',
        images: [], schemaName: 'noop', schema: { type: 'object' }, maxTokens: 16, timeoutMs: 20_000,
      })
      setState({ busy: false, ok: true, msg: t('settings.saved') })
    } catch (e) {
      const err = e instanceof AIError ? e : classifyStatus(0)
      setState({ busy: false, ok: false, msg: `${t(err.i18nKey)}${err.detail ? ` — ${err.detail}` : ''}` })
    }
  }

  const model = settings.selection.mode === 'single' ? settings.selection.single : settings.selection.agent[0]
  if (!model) return null
  return (
    <div className="row-end test-row">
      <button className="button" onClick={test} disabled={state.busy}>{state.busy ? t('common.loading') : `⚡ Test: ${model.model}`}</button>
      {state.msg && <span className={'notice notice--inline ' + (state.ok ? 'notice--ok' : 'notice--error')}><KeyRound size={13} />{state.msg}</span>}
    </div>
  )
}
