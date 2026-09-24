import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { getExam } from '../db'
import { runExam } from '../lib/examRunner'
import type { ProgressEvent } from '../lib/pipeline'
import { useSettings } from '../lib/SettingsContext'
import { useI18n } from '../i18n'
import { PipelineOverlay } from '../components/PipelineOverlay'

export function ExaminePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { settings, reload } = useSettings()
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  const execute = useCallback(async () => {
    setError(null)
    setProgress(null)
    reload()
    const exam = await getExam(id)
    if (!exam) { navigate('/', { replace: true }); return }
    const selection = settings.selection
    if (selection.mode === 'single' && !selection.single) { setError(t('errors.noModels')); return }
    if (selection.mode === 'agent' && selection.agent.length === 0) { setError(t('errors.noModels')); return }
    try {
      await runExam(exam, selection, (e) => setProgress(e))
      navigate(`/report/${id}`, { replace: true })
    } catch (e) {
      const key = (e as { i18nKey?: string }).i18nKey
      const detail = (e as { detail?: string }).detail
      setError(t((key ?? 'errors.unknown') as never) + (detail ? ` — ${detail}` : ''))
    }
  }, [id, navigate, reload, settings.selection, t])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void execute()
  }, [execute, attempt])

  const retry = () => {
    startedRef.current = false
    setAttempt((a) => a + 1)
  }

  return (
    <div className="content content--examine">
      <AnimatePresence>
        {error
          ? <PipelineOverlay stage="finishing" models={[]} error={error} onRetry={retry} onHome={() => navigate('/')} />
          : <PipelineOverlay stage={progress?.stage ?? 'preparing'} detail={progress?.detail} models={progress?.models ?? []} onHome={() => navigate('/')} />}
      </AnimatePresence>
    </div>
  )
}
