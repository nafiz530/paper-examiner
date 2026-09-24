import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, BrainCircuit, FileText, ImagePlus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { deleteExam, listExams, saveExam, type ExamRecord, type ExamStatus, type PaperItem, type PaperSide } from '../db'
import { userModelRefs } from '../lib/settings'
import { useServerModels } from '../lib/serverModels'
import { useSettings } from '../lib/SettingsContext'
import { useI18n } from '../i18n'
import { Workspace } from '../components/Workspace'

function emptyExam(): ExamRecord {
  return { id: crypto.randomUUID(), title: '', subject: '', totalMarks: null, status: 'draft', createdAt: Date.now(), updatedAt: Date.now(), questions: [], answers: [] }
}

export function HomePage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n()
  const { settings } = useSettings()
  const server = useServerModels()
  const navigate = useNavigate()
  const [exam, setExam] = useState<ExamRecord>(emptyExam)
  const [loaded, setLoaded] = useState(false)
  const [recent, setRecent] = useState<ExamRecord[]>([])
  const [savedFlash, setSavedFlash] = useState(false)
  const examRef = useRef(exam)
  examRef.current = exam

  // restore last draft + load recent list
  useEffect(() => {
    void (async () => {
      try {
        const rows = await listExams()
        setRecent(rows.slice(0, 8))
        const pointer = localStorage.getItem('paper-examiner-current')
        if (pointer) {
          const draft = rows.find((r) => r.id === JSON.parse(pointer).id && r.status === 'draft')
          if (draft) setExam(draft)
        }
      } finally { setLoaded(true) }
    })()
  }, [])

  // debounced draft autosave (skip untouched empty exams so we don't litter storage)
  useEffect(() => {
    if (!loaded) return
    const e = examRef.current
    if (e.questions.length === 0 && e.answers.length === 0 && !e.title && !e.subject && e.totalMarks == null) return
    const timer = setTimeout(() => {
      void saveExam({ ...examRef.current, updatedAt: Date.now() })
        .then(() => {
          localStorage.setItem('paper-examiner-current', JSON.stringify({ id: examRef.current.id }))
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 900)
          return listExams()
        })
        .then((rows) => rows && setRecent(rows.slice(0, 8)))
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [exam, loaded])

  const update = useCallback((side: PaperSide, items: PaperItem[]) => {
    setExam((e) => ({ ...e, [side]: items }))
  }, [])

  const ready = exam.questions.length > 0 && exam.answers.length > 0
  const imageCount = useMemo(() => [...exam.questions, ...exam.answers].filter((x) => x.type === 'image').length, [exam])
  const selection = settings.selection
  const selectedModels = selection.mode === 'single' ? (selection.single ? [selection.single] : []) : selection.agent
  const available = useMemo(() => ({ free: server.models, yours: userModelRefs(settings.userProviders) }), [server.models, settings.userProviders])
  const anyAvailable = available.free.length + available.yours.length > 0

  const run = () => {
    if (!ready || selectedModels.length === 0) { onOpenSettings(); return }
    void saveExam({ ...exam, updatedAt: Date.now() }).then(() => navigate(`/examine/${exam.id}`))
  }

  const del = async (id: string) => {
    if (!confirm(t('home.deleteConfirm'))) return
    await deleteExam(id)
    setRecent((rows) => rows.filter((r) => r.id !== id))
    if (exam.id === id) setExam(emptyExam())
  }

  return (
    <div className="content">
      <motion.header className="hero" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="hero__copy">
          <div className="eyebrow"><Sparkles size={14} /> {t('home.heroEyebrow')}</div>
          <h1>{t('home.heroTitleA')}<br /><em>{t('home.heroTitleB')}</em></h1>
          <p>{t('home.heroSub')}</p>
        </div>
        <div className="hero__status">
          <div className="status-card">
            <span>{ready ? t('home.status.ready') : t('home.status.add')}</span>
            <strong>{ready ? '✓' : '···'}</strong>
            <div className="status-line"><i className={ready ? 'is-ready' : ''} /></div>
            <small>{t('home.status.hint', { q: exam.questions.length, a: exam.answers.length })}</small>
          </div>
        </div>
      </motion.header>

      <section className="exam-meta">
        <div><label>{t('home.paperName')}</label><input value={exam.title} onChange={(e) => setExam((x) => ({ ...x, title: e.target.value }))} placeholder={t('home.paperNamePh')} /></div>
        <div><label>{t('home.subject')} <span>{t('common.optional')}</span></label><input value={exam.subject} onChange={(e) => setExam((x) => ({ ...x, subject: e.target.value }))} placeholder={t('home.subjectPh')} /></div>
        <div><label>{t('home.totalMarks')} <span>{t('common.optional')}</span></label><input type="number" min="0" value={exam.totalMarks ?? ''} onChange={(e) => setExam((x) => ({ ...x, totalMarks: e.target.value === '' ? null : Number(e.target.value) }))} placeholder={t('home.totalMarksPh')} /></div>
      </section>

      <div className="workspace-stack">
        <Workspace title={t('home.qTitle')} description={t('home.qDesc')} side="questions" items={exam.questions} onChange={(v) => update('questions', v)} />
        <div className="flow-divider"><span>→</span><ArrowUpRight size={16} /></div>
        <Workspace title={t('home.aTitle')} description={t('home.aDesc')} side="answers" items={exam.answers} onChange={(v) => update('answers', v)} />
      </div>

      <motion.section className="launch-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
        <div>
          <div className="eyebrow"><BrainCircuit size={14} /> {t('models.title')}</div>
          <h3>{selectedModels.length === 0 ? t('models.none.title') : selectedModels.map((m) => m.model).join(' + ')}</h3>
          <p>{ready ? t('home.launchReady') : t('home.launchAdd')} · {t('home.launchHint', { images: imageCount })}{savedFlash ? ' ✓' : ''}</p>
        </div>
        <div className="launch-actions">
          <button className="button" onClick={onOpenSettings}><Settings2 size={15} /> {selectedModels.length === 0 ? (anyAvailable ? t('models.title') : t('settings.title')) : t('models.change')}</button>
          <button className="button button--primary" disabled={!ready || selectedModels.length === 0} onClick={run}>
            <BrainCircuit size={17} />{t('home.run')} <ArrowUpRight size={17} />
          </button>
        </div>
      </motion.section>

      {recent.length > 0 && (
        <section className="recent">
          <h3 className="subhead">{t('home.recent')}</h3>
          <div className="recent-grid">
            {recent.map((r, i) => (
              <motion.article key={r.id} className="recent-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div className="recent-card__head">
                  <strong>{r.title || r.subject || '—'}</strong>
                  <span className={'badge badge--' + r.status}>{t(`home.badge.${r.status}` as never)}</span>
                </div>
                {r.evaluation && <p className="recent-card__score">{r.evaluation.obtainedMarks} / {r.evaluation.totalMarks} · {r.evaluation.percentage}%</p>}
                {r.status === 'failed' && <p className="recent-card__score">{t('examine.failed')}</p>}
                <div className="recent-card__actions">
                  {r.status === 'done'
                    ? <button className="button" onClick={() => navigate(`/report/${r.id}`)}>{t('home.viewReport')}</button>
                    : <button className="button" onClick={() => navigate(`/examine/${r.id}`)}>{r.status === 'failed' ? t('home.tryAgain') : t('home.resume')}</button>}
                  <button className="icon-button" aria-label={t('common.delete')} onClick={() => void del(r.id)}><Trash2 size={15} /></button>
                </div>
              </motion.article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
