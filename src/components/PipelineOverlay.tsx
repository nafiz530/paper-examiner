import { motion } from 'framer-motion'
import { BrainCircuit, Check, CircleAlert, Loader2 } from 'lucide-react'
import type { ModelProgress, PipelineStage } from '../lib/pipeline'
import { useI18n } from '../i18n'

const STAGES: PipelineStage[] = ['preparing', 'reconstructing', 'reviewing', 'adjudicating', 'grading', 'finishing']

export function PipelineOverlay({ stage, detail, models, error, onRetry, onHome }: {
  stage: PipelineStage
  detail?: string
  models: ModelProgress[]
  error?: string | null
  onRetry?: () => void
  onHome: () => void
}) {
  const { t } = useI18n()
  const single = stage === 'grading'
  const visibleStages = single ? ['preparing', 'grading', 'finishing'] : ['preparing', 'reconstructing', 'reviewing', 'adjudicating', 'finishing']
  const currentIndex = visibleStages.indexOf(stage)

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
            <h3>{t(single ? 'examine.stage.grading' : `examine.stage.${stage}` as never)}</h3>
            {detail && <p className="pipeline-detail">{detail}</p>}
            <div className="pipeline-steps">
              {visibleStages.map((s, i) => (
                <div className={'pipeline-step ' + (i < currentIndex ? 'done ' : '') + (s === stage ? 'active' : '')} key={s}>
                  <span>{i < currentIndex ? <Check size={14} /> : s === stage ? <Loader2 size={14} className="spin" /> : i + 1}</span>
                  <strong>{t(`examine.stage.${s}` as never)}</strong>
                </div>
              ))}
            </div>
            {models.length > 0 && (
              <div className="model-progress">
                {models.map((m) => (
                  <div className={'model-progress__row ' + m.state} key={m.key}>
                    {m.state === 'done' ? <Check size={14} /> : m.state === 'running' ? <Loader2 size={14} className="spin" /> : m.state === 'error' ? <CircleAlert size={14} /> : <span className="dot" />}
                    <strong>{m.model}</strong>
                    <span>{m.label}</span>
                    <em>{m.state === 'done' ? t('examine.modelDone') : m.state === 'running' ? t('examine.modelRunning') : m.state === 'error' ? t('examine.modelError') : t('examine.modelPending')}</em>
                  </div>
                ))}
              </div>
            )}
            <div className="pipeline-rule">{t('examine.agentNote')}</div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
