import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BrainCircuit, Check, CircleAlert, Coins, Loader2, Timer } from 'lucide-react'
import type { ModelProgress, PipelineStage, QuestionChip } from '../lib/pipeline'
import { formatTokens } from '../lib/tokens'
import { useI18n } from '../i18n'

const SINGLE_STAGES: PipelineStage[] = ['preparing', 'extracting', 'grading', 'coaching', 'finishing']
const AGENT_STAGES: PipelineStage[] = ['preparing', 'extracting', 'reviewing', 'adjudicating', 'coaching', 'finishing']

const CHIP_TONE: Record<string, string> = {
  correct: 'chip--good',
  partially_correct: 'chip--warn',
  incorrect: 'chip--bad',
  unanswered: 'chip--mute',
  unclear: 'chip--mute',
}

/** Animated integer count-up used by the live token meter. */
function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return display
}

function TokenMeter({ tokens }: { tokens?: ProgressTokens }) {
  const { t } = useI18n()
  const total = tokens?.totalTokens ?? 0
  const shown = useCountUp(total)
  if (!tokens || (total === 0 && tokens.calls === 0)) return null
  return (
    <motion.div className="token-meter" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Coins size={14} />
      <motion.strong key={shown} initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: 0.18 }}>{formatTokens(shown)}</motion.strong>
      <span>{t('tokens.live')}</span>
      {tokens.estimated && <em>≈</em>}
      <em>{tokens.calls} {t('tokens.calls')}</em>
    </motion.div>
  )
}

type ProgressTokens = { promptTokens: number; completionTokens: number; totalTokens: number; calls: number; estimated: boolean }

function ElapsedClock({ running }: { running: boolean }) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const id = setInterval(() => setMs(Date.now() - started), 1000)
    return () => clearInterval(id)
  }, [running])
  const s = Math.floor(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return (
    <div className="elapsed-clock"><Timer size={13} /> {mm}:{ss}</div>
  )
}

export function PipelineOverlay({ stage, detail, models, error, questionResults, tokens, counts, mode = 'agent', onRetry, onHome }: {
  stage: PipelineStage
  detail?: string
  models: ModelProgress[]
  error?: string | null
  questionResults?: QuestionChip[]
  tokens?: ProgressTokens
  counts?: { done: number; total: number }
  mode?: 'single' | 'agent'
  onRetry?: () => void
  onHome: () => void
}) {
  const { t } = useI18n()
  const visibleStages = mode === 'single' ? SINGLE_STAGES : AGENT_STAGES
  const currentIndex = Math.max(0, visibleStages.indexOf(stage))
  const chips = questionResults ?? []

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="modal modal--pipeline"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <motion.div className="pipeline-orb" animate={error ? {} : { scale: [1, 1.06, 1], rotate: [0, 3, -3, 0] }} transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}>
          <BrainCircuit size={28} />
        </motion.div>
        <div className="eyebrow">{t('examine.title')}</div>

        {error ? (
          <>
            <h3 className="pipeline-error-title"><CircleAlert size={18} /> {t('examine.failed')}</h3>
            <p className="pipeline-detail pipeline-detail--error">{error}</p>
            <div className="row-end">
              {onRetry && <button className="button button--primary" onClick={onRetry}>{t('examine.retry')}</button>}
              <button className="button" onClick={onHome}>{t('examine.backHome')}</button>
            </div>
          </>
        ) : (
          <>
            <h3>{t(`examine.stage.${stage}` as never)}</h3>
            {detail && <p className="pipeline-detail">{detail}</p>}
            <div className="pipeline-steps">
              {visibleStages.map((s, i) => (
                <div className={'pipeline-step ' + (i < currentIndex ? 'done ' : '') + (s === stage ? 'active' : '')} key={s}>
                  <span>{i < currentIndex ? <Check size={14} /> : s === stage ? <Loader2 size={14} className="spin" /> : i + 1}</span>
                  <strong>{t(`examine.stage.${s}` as never)}</strong>
                </div>
              ))}
            </div>

            {counts && counts.total > 0 && (
              <div className="q-progress-line">
                <div className="q-progress-bar"><motion.i animate={{ width: `${Math.round((counts.done / counts.total) * 100)}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} /></div>
                <span>{t('examine.questionsMarked', { done: counts.done, total: counts.total })}</span>
              </div>
            )}

            {chips.length > 0 && (
              <div className="q-chips">
                <AnimatePresence initial={false}>
                  {chips.map((c, i) => (
                    <motion.span
                      key={c.number + i}
                      className={'q-chip ' + (CHIP_TONE[c.verdict] ?? 'chip--mute')}
                      initial={{ opacity: 0, scale: 0.6, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    >
                      <b>Q{c.number}</b>
                      <em>{c.awarded}{c.max != null ? `/${c.max}` : ''}</em>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {models.length > 0 && (
              <div className="model-progress">
                {models.map((m) => (
                  <div className={'model-progress__row ' + m.state} key={m.key}>
                    {m.state === 'done' ? <Check size={14} /> : m.state === 'running' ? <Loader2 size={14} className="spin" /> : m.state === 'error' ? <CircleAlert size={14} /> : <span className="dot" />}
                    <strong>{m.model}</strong>
                    <span>{m.label}</span>
                    <em>{m.state === 'done' ? (m.detail ? m.detail : t('examine.modelDone')) : m.state === 'running' ? t('examine.modelRunning') : m.state === 'error' ? t('examine.modelError') : t('examine.modelPending')}</em>
                  </div>
                ))}
              </div>
            )}

            <div className="pipeline-meter-row">
              <TokenMeter tokens={tokens} />
              <ElapsedClock running />
            </div>
            <div className="pipeline-rule">{mode === 'agent' ? t('examine.agentNote') : t('examine.singleNote')}</div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
