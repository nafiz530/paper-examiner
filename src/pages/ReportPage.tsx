import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileQuestion, Home, RotateCcw } from 'lucide-react'
import { getExam, type ExamRecord } from '../db'
import { useI18n } from '../i18n'
import { ReportView } from '../components/report/ReportView'

export function ReportPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [exam, setExam] = useState<ExamRecord | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    void getExam(id).then((x) => {
      if (x) setExam(x)
      else setMissing(true)
    })
  }, [id])

  if (missing) {
    return (
      <div className="content content--empty">
        <div className="empty-state">
          <FileQuestion size={40} />
          <p>{t('report.empty')}</p>
          <Link className="button button--primary" to="/"><Home size={15} /> {t('report.home')}</Link>
        </div>
      </div>
    )
  }
  if (!exam) return <div className="content content--empty"><p>{t('common.loading')}</p></div>

  return (
    <div className="content">
      {exam.evaluation ? (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <ReportView report={exam.evaluation} />
          </motion.div>
          <div className="report-actions">
            <button className="button" onClick={() => navigate(`/examine/${exam.id}`)}><RotateCcw size={15} /> {t('report.rerun')}</button>
            <Link className="button button--primary" to="/"><Home size={15} /> {t('report.home')}</Link>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <FileQuestion size={40} />
          <p>{t('report.empty')}</p>
          <Link className="button button--primary" to="/"><Home size={15} /> {t('report.home')}</Link>
        </div>
      )}
    </div>
  )
}
