import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, CircleHelp, CircleX, HelpCircle,
  Languages, Lightbulb, MinusCircle, Sparkles, TrendingUp, Users, XCircle,
} from 'lucide-react'
import type { UnifiedReport } from '../../lib/pipeline'
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
          points={poly((i) => R)}
          fill="none" stroke="transparent"
        />
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

function QuestionRow({ q, index }: { q: UnifiedReport['questions'][number]; index: number }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(index < 3)
  const Icon = VERDICT_ICON[q.verdict] ?? CircleHelp
  const ratio = q.maxMarks ? q.awardedMarks / q.maxMarks : 0
  const color = ratio >= 0.8 ? '#16a34a' : ratio >= 0.4 ? '#d97706' : '#dc2626'

  return (
    <motion.div
      className={'q-row ' + (open ? 'is-open' : '')}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(0.5, index * 0.06), duration: 0.35, ease: 'easeOut' }}
    >
      <button className="q-row__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon size={18} style={{ color }} />
        <strong>Q{q.number}</strong>
        {q.topic && <span className="q-row__topic">{q.topic}</span>}
        <span className="q-row__verdict">{t(`report.verdict.${q.verdict}` as never)}</span>
        <b style={{ color }}>{q.awardedMarks}{q.maxMarks != null ? ` / ${q.maxMarks}` : ''}</b>
      </button>
      {open && (
        <motion.div className="q-row__body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.25 }}>
          <div className="q-row__bar"><i style={{ width: `${Math.round(ratio * 100)}%`, background: color }} /></div>
          <p>{q.explanation}</p>
          {q.evidence.length > 0 && (
            <div className="q-evidence">
              {q.evidence.map((e, i) => <blockquote key={i}>{e}</blockquote>)}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
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
  const { t } = useI18n()
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

export function ReportView({ report }: { report: UnifiedReport }) {
  const { t } = useI18n()
  return (
    <div className="report">
      <motion.div className="report-hero" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <ScoreRing percentage={report.percentage} obtained={report.obtainedMarks} total={report.totalMarks} />
        <div className="report-hero__info">
          <div className="eyebrow"><Sparkles size={14} /> {t(report.mode === 'agent' ? 'report.mode.agent' : 'report.mode.single')}</div>
          <h2>{report.paperTitle || report.subject || t('report.score')}</h2>
          {report.grade && <span className="grade-badge">{report.grade}</span>}
          <p className="report-summary">{report.summary}</p>
          <div className="report-meta">
            <span><Languages size={14} /> {t('report.reportIn', { lang: langName(report.reportLanguage) })}</span>
            {report.confidence > 0 && <span><TrendingUp size={14} /> {report.confidence}% {t('report.confidence')}</span>}
          </div>
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

      <motion.section className="report-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34, duration: 0.4 }}>
        <div className="report-card__head">
          <h3>{t('report.questions')}</h3>
          <span>{report.questions.length}</span>
        </div>
        <div className="q-list">
          {report.questions.map((q, i) => <QuestionRow key={q.number + i} q={q} index={i} />)}
        </div>
      </motion.section>

      {report.reviewerSummaries.length > 0 && (
        <motion.details className="report-card report-details" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          <summary><Users size={16} /> {t('report.reviewers')} ({report.reviewerSummaries.length})</summary>
          {report.reviewerSummaries.map((r, i) => (
            <div className="reviewer-block" key={i}>
              <div><strong>{r.model}</strong><span>{r.proposedTotalMarks} · {r.confidence}%</span></div>
              <p>{r.summary}</p>
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

      {report.usedModels.length > 0 && (
        <div className="report-footer">
          {report.usedModels.map((m, i) => <span className="model-chip" key={i}>{m}</span>)}
        </div>
      )}
    </div>
  )
}
