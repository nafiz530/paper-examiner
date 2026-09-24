import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, CircleHelp, CircleX, ClipboardCopy,
  Coins, FileJson, HelpCircle, Languages, Lightbulb, MinusCircle, Printer,
  Sparkles, Timer, TrendingUp, Users, XCircle,
} from 'lucide-react'
import type { UnifiedReport } from '../../lib/pipeline'
import { formatTokens } from '../../lib/tokens'
import { langName, useI18n } from '../../i18n'

/* ------------------------------- Score ring -------------------------------- */

function ScoreRing({ percentage, obtained, total }: { percentage: number; obtained: number; total: number }) {
  const { t } = useI18n()
  const [display, setDisplay] = useState(0)
  const R = 84
  const C = 2 * Math.PI * R
  const pct = Math.max(0, Math.min(100, percentage))

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const dur = 1400
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(eased * pct * 100) / 100)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#4f46e5' : pct >= 40 ? '#d97706' : '#dc2626'

  return (
    <div className="score-ring-wrap">
      <svg viewBox="0 0 200 200" className="score-ring">
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--ring-track)" strokeWidth="14" />
        <motion.circle
          cx="100" cy="100" r={R} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C - (C * pct) / 100 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="score-ring__center">
        <strong>{obtained}<span>/{total}</span></strong>
        <em>{display.toFixed(display % 1 === 0 ? 0 : 2)}%</em>
        <small>{t('report.score')}</small>
      </div>
    </div>
  )
}

/* --------------------------------- Confetti --------------------------------- */

/** Lightweight canvas confetti burst — fired once for scores >= 80%. */
function Confetti({ fire }: { fire: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!fire) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = canvas.width = window.innerWidth * dpr
    const H = canvas.height = window.innerHeight * dpr
    const colors = ['#16a34a', '#4f46e5', '#d97706', '#dc2626', '#0ea5e9', '#eab308']
    const pieces = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.25,
      y: H * 0.28 + (Math.random() - 0.5) * 60 * dpr,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (Math.random() - 1.1) * 12 * dpr,
      w: (4 + Math.random() * 5) * dpr,
      h: (8 + Math.random() * 7) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      ctx.clearRect(0, 0, W, H)
      let alive = false
      for (const p of pieces) {
        p.vy += 0.22 * dpr
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        if (p.y < H + 40) alive = true
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 3200)
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      if (alive && elapsed < 3400) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fire])
  if (!fire) return null
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />
}

/* ------------------------------- Radar chart ------------------------------- */

function RadarChart({ topics }: { topics: Array<{ topic: string; score: number }> }) {
  const data = topics.slice(0, 8)
  if (data.length < 3) return null
  const size = 260
  const c = size / 2
  const R = 92
  const angle = (i: number) => (Math.PI * 2 * i) / data.length - Math.PI / 2
  const point = (i: number, r: number) => `${c + Math.cos(angle(i)) * r},${c + Math.sin(angle(i)) * r}`
  const poly = (r: (i: number) => number) => data.map((_, i) => point(i, r(i))).join(' ')

  return (
    <div className="radar-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="radar">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={poly(() => R * f)} fill="none" stroke="var(--ring-track)" strokeWidth="1" />
        ))}
        {data.map((_, i) => (
          <line key={i} x1={c} y1={c} x2={c + Math.cos(angle(i)) * R} y2={c + Math.sin(angle(i)) * R} stroke="var(--ring-track)" strokeWidth="1" />
        ))}
        <motion.polygon
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.3 }}
          style={{ transformOrigin: 'center' }}
          points={poly((i) => (R * Math.max(4, data[i].score)) / 100)}
          fill="rgba(79,70,229,0.18)" stroke="#4f46e5" strokeWidth="2"
        />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={c + Math.cos(angle(i)) * (R * Math.max(4, d.score)) / 100} cy={c + Math.sin(angle(i)) * (R * Math.max(4, d.score)) / 100} r="3.5" fill="#4f46e5" />
            <text
              x={c + Math.cos(angle(i)) * (R + 22)}
              y={c + Math.sin(angle(i)) * (R + 22)}
              textAnchor={Math.cos(angle(i)) > 0.3 ? 'start' : Math.cos(angle(i)) < -0.3 ? 'end' : 'middle'}
              dominantBaseline="middle"
              className="radar-label"
            >
              {d.topic.length > 18 ? d.topic.slice(0, 17) + '…' : d.topic}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/* ------------------------------ Question rows ------------------------------ */

const VERDICT_ICON: Record<string, typeof CheckCircle2> = {
  correct: CheckCircle2,
  partially_correct: HelpCircle,
  incorrect: XCircle,
  unanswered: MinusCircle,
  unclear: CircleHelp,
}

function QuestionRow({ q, index, forceOpen }: { q: UnifiedReport['questions'][number]; index: number; forceOpen: boolean | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(index < 3)
  // expand-all / collapse-all from the toolbar overrides individual state
  useEffect(() => { if (forceOpen !== null) setOpen(forceOpen) }, [forceOpen])
  const Icon = VERDICT_ICON[q.verdict] ?? CircleHelp
  const ratio = q.maxMarks ? q.awardedMarks / q.maxMarks : 0
  const color = ratio >= 0.8 ? '#16a34a' : ratio >= 0.4 ? '#d97706' : '#dc2626'
  const mistakes = q.mistakes ?? []
  const correctSteps = q.whatWasCorrect ?? []

  return (
    <motion.div
      className={'q-row ' + (open ? 'is-open' : '')}
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(0.5, index * 0.06), duration: 0.35, ease: 'easeOut' }}
    >
      <button className="q-row__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon size={18} style={{ color }} />
        <strong>Q{q.number}</strong>
        {q.topic && <span className="q-row__topic">{q.topic}</span>}
        <span className="q-row__verdict">{t(`report.verdict.${q.verdict}` as never)}</span>
        <b style={{ color }}>{q.awardedMarks}{q.maxMarks != null ? ` / ${q.maxMarks}` : ''}</b>
        <ChevronDown size={15} className={'q-row__chevron ' + (open ? 'is-open' : '')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="q-row__body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
            <div className="q-row__bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.round(ratio * 100)}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} style={{ background: color }} /></div>
            <p>{q.explanation}</p>
            {q.dispute && <p className="q-row__dispute"><CircleHelp size={14} /> {q.dispute}</p>}
            {correctSteps.length > 0 && (
              <div className="q-sub q-sub--good">
                <h5><CheckCircle2 size={13} /> {t('report.correctSteps')}</h5>
                <ul>{correctSteps.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {mistakes.length > 0 && (
              <div className="q-sub q-sub--bad">
                <h5><AlertTriangle size={13} /> {t('report.mistakes')}</h5>
                <ul>{mistakes.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {q.evidence.length > 0 && (
              <div className="q-evidence">
                {q.evidence.map((e, i) => <blockquote key={i}>{e}</blockquote>)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ------------------------------ Token usage card ---------------------------- */

function TokenUsageCard({ usage }: { usage: NonNullable<UnifiedReport['usage']> }) {
  const { t } = useI18n()
  return (
    <motion.section className="report-card report-card--tokens" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32, duration: 0.4 }}>
      <div className="report-card__head">
        <h3><Coins size={17} /> {t('tokens.title')}</h3>
        <span className="token-total-badge">
          <strong>{formatTokens(usage.totalTokens)}</strong>
          {usage.estimated && <em title={t('tokens.estimatedHint')}>≈</em>}
        </span>
      </div>
      <div className="token-grid">
        <div className="token-stat"><span>{t('tokens.prompt')}</span><strong>{formatTokens(usage.promptTokens)}</strong></div>
        <div className="token-stat"><span>{t('tokens.completion')}</span><strong>{formatTokens(usage.completionTokens)}</strong></div>
        <div className="token-stat"><span>{t('tokens.calls')}</span><strong>{usage.calls}</strong></div>
        <div className="token-stat"><span>{t('tokens.total')}</span><strong>{formatTokens(usage.totalTokens)}</strong></div>
      </div>
      {usage.byPhase.length > 0 && (
        <div className="token-table">
          <div className="token-table__head"><span>{t('tokens.byPhase')}</span><span>{t('tokens.prompt')}</span><span>{t('tokens.completion')}</span><span>{t('tokens.total')}</span></div>
          {usage.byPhase.map((p) => (
            <div className="token-table__row" key={p.phase}>
              <span>{t(`tokens.phase.${p.phase}` as never)}{p.calls > 1 ? ` ×${p.calls}` : ''}</span>
              <span>{formatTokens(p.promptTokens)}{p.estimated ? ' ≈' : ''}</span>
              <span>{formatTokens(p.completionTokens)}{p.estimated ? ' ≈' : ''}</span>
              <span>{formatTokens(p.totalTokens)}</span>
            </div>
          ))}
        </div>
      )}
      {usage.byModel.length > 0 && (
        <div className="token-table">
          <div className="token-table__head"><span>{t('tokens.byModel')}</span><span>{t('tokens.prompt')}</span><span>{t('tokens.completion')}</span><span>{t('tokens.total')}</span></div>
          {usage.byModel.map((m) => (
            <div className="token-table__row" key={m.model}>
              <span title={m.model}>{m.model.length > 28 ? m.model.slice(0, 27) + '…' : m.model}</span>
              <span>{formatTokens(m.promptTokens)}{m.estimated ? ' ≈' : ''}</span>
              <span>{formatTokens(m.completionTokens)}{m.estimated ? ' ≈' : ''}</span>
              <span>{formatTokens(m.totalTokens)}</span>
            </div>
          ))}
        </div>
      )}
    </motion.section>
  )
}

/* --------------------------------- Section --------------------------------- */

function Section({ icon: Icon, title, items, tone, delay }: {
  icon: typeof CheckCircle2
  title: string
  items: string[]
  tone: 'good' | 'bad' | 'idea' | 'next'
  delay: number
}) {
  if (items.length === 0) return null
  return (
    <motion.section
      className={`report-card report-card--${tone}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
    >
      <h3><Icon size={17} /> {title}</h3>
      <ul>
        {items.map((x, i) => <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: delay + 0.08 + i * 0.04 }}>{x}</motion.li>)}
      </ul>
    </motion.section>
  )
}

/* --------------------------------- Report ---------------------------------- */

const FILTERS = ['all', 'correct', 'partially_correct', 'incorrect', 'unanswered', 'unclear'] as const
type Filter = typeof FILTERS[number]

export function ReportView({ report }: { report: UnifiedReport }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')
  const [expandAll, setExpandAll] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: report.questions.length }
    for (const q of report.questions) c[q.verdict] = (c[q.verdict] ?? 0) + 1
    return c
  }, [report.questions])

  const filtered = useMemo(
    () => filter === 'all' ? report.questions : report.questions.filter((q) => q.verdict === filter),
    [filter, report.questions],
  )

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paper-examiner-report-${Date.now()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const copySummary = async () => {
    const lines = [
      `${report.paperTitle || report.subject || t('report.score')}: ${report.obtainedMarks}/${report.totalMarks} (${report.percentage}%, ${report.grade})`,
      report.summary,
      ...report.questions.map((q) => `Q${q.number}${q.topic ? ` (${q.topic})` : ''}: ${q.awardedMarks}${q.maxMarks != null ? `/${q.maxMarks}` : ''} — ${q.verdict}`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard unavailable */ }
  }

  const duration = report.timing ? Math.round(report.timing.durationMs / 1000) : null

  return (
    <div className="report">
      <Confetti fire={report.percentage >= 80} />

      <motion.div className="report-hero" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <ScoreRing percentage={report.percentage} obtained={report.obtainedMarks} total={report.totalMarks} />
        <div className="report-hero__info">
          <div className="eyebrow"><Sparkles size={14} /> {t(report.mode === 'agent' ? 'report.mode.agent' : 'report.mode.single')}</div>
          <h2>{report.paperTitle || report.subject || t('report.score')}</h2>
          <div className="report-hero__badges">
            {report.grade && <span className="grade-badge">{report.grade}</span>}
            {duration != null && <span className="duration-badge"><Timer size={13} /> {duration}s</span>}
          </div>
          <p className="report-summary">{report.summary}</p>
          <div className="report-meta">
            <span><Languages size={14} /> {t('report.reportIn', { lang: langName(report.reportLanguage) })}</span>
            {report.confidence > 0 && <span><TrendingUp size={14} /> {report.confidence}% {t('report.confidence')}</span>}
          </div>
        </div>
        <div className="report-export">
          <button className="icon-button" title={t('report.exportJson')} aria-label={t('report.exportJson')} onClick={downloadJson}><FileJson size={16} /></button>
          <button className="icon-button" title={t('report.print')} aria-label={t('report.print')} onClick={() => window.print()}><Printer size={16} /></button>
          <button className="icon-button" title={t('report.copySummary')} aria-label={t('report.copySummary')} onClick={() => void copySummary()}>
            {copied ? <CheckCircle2 size={16} className="is-good" /> : <ClipboardCopy size={16} />}
          </button>
        </div>
      </motion.div>

      <div className="report-grid">
        <Section icon={CheckCircle2} title={t('report.strengths')} items={report.strengths} tone="good" delay={0.1} />
        <Section icon={AlertTriangle} title={t('report.weaknesses')} items={report.weaknesses} tone="bad" delay={0.16} />
        <Section icon={Lightbulb} title={t('report.suggestions')} items={report.suggestions} tone="idea" delay={0.22} />
        <Section icon={ArrowUpRight} title={t('report.recommendations')} items={report.recommendations} tone="next" delay={0.28} />
      </div>

      {report.topicMastery.length >= 3 && (
        <motion.section className="report-card report-card--radar" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
          <h3><TrendingUp size={17} /> {t('report.topics')}</h3>
          <RadarChart topics={report.topicMastery} />
        </motion.section>
      )}

      {report.usage && <TokenUsageCard usage={report.usage} />}

      <motion.section className="report-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34, duration: 0.4 }}>
        <div className="report-card__head">
          <h3>{t('report.questions')}</h3>
          <span>{report.questions.length}</span>
        </div>

        <div className="q-toolbar">
          <div className="filter-chips" role="tablist">
            {FILTERS.map((f) => {
              const n = counts[f] ?? 0
              if (f !== 'all' && n === 0) return null
              return (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  className={'filter-chip ' + (filter === f ? 'is-active' : '') + ' filter-chip--' + f}
                  onClick={() => setFilter(f)}
                >
                  {t(`report.verdict.${f === 'all' ? 'all' : f}` as never)} <em>{n}</em>
                </button>
              )
            })}
          </div>
          <button className="text-button" onClick={() => setExpandAll(expandAll === true ? false : true)}>
            {expandAll === true ? t('report.collapseAll') : t('report.expandAll')}
          </button>
        </div>

        <motion.div className="q-list" layout>
          <AnimatePresence initial={false}>
            {filtered.map((q, i) => (
              <QuestionRow key={q.number + i} q={q} index={i} forceOpen={expandAll} />
            ))}
          </AnimatePresence>
        </motion.div>
        {filtered.length === 0 && <p className="empty-note">{t('report.noQuestionsInFilter')}</p>}
      </motion.section>

      {report.reviewerSummaries.length > 0 && (
        <motion.details className="report-card report-details" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          <summary><Users size={16} /> {t('report.reviewers')} ({report.reviewerSummaries.length})</summary>
          {report.reviewerSummaries.map((r, i) => (
            <div className="reviewer-block" key={i}>
              <div><strong>{r.model}</strong><span>{r.proposedTotalMarks} · {r.summary}</span></div>
            </div>
          ))}
          {report.disagreements.length > 0 && (
            <>
              <h3 className="subhead">{t('report.disagreements')}</h3>
              <ul className="plain-ul">{report.disagreements.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </>
          )}
        </motion.details>
      )}

      {report.notes.length > 0 && (
        <motion.details className="report-card report-details" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.42 }}>
          <summary><CircleHelp size={16} /> {t('report.notes')}</summary>
          <ul className="plain-ul">{report.notes.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </motion.details>
      )}

      {report.usedModels.length > 0 && (
        <div className="report-footer">
          {report.usedModels.map((m, i) => <span className="model-chip" key={i}>{m}</span>)}
        </div>
      )}
    </div>
  )
}
