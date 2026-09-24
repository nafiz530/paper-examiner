import { getExam, saveExam, type ExamRecord } from '../db'
import { compressImage } from './compress'
import { blobToDataUrl } from './compress'
import { loadSettings, saveSettings, type ModelRef, type Selection } from './settings'
import { ADMIN_SETTINGS } from '../config/examiner.config'
import { runAgentMode, runSingleMode, normalizeReport } from './pipeline'
import { AIError } from './aiErrors'
import type { ProgressEvent } from './pipeline'
import type { ImagePart } from './providers'

/** Daily usage cap for admin-provided keys (client-side, by design). */
export function checkUsageCap(selection: Selection): boolean {
  const usesAdminKeys = selection.mode === 'single' ? selection.single?.source === 'admin' : selection.agent.some((m) => m.source === 'admin')
  if (!usesAdminKeys) return true
  const s = loadSettings()
  const today = new Date().toISOString().slice(0, 10)
  if (s.lastRunDate !== today) return true
  return s.runsToday < ADMIN_SETTINGS.freeExamsPerDay
}

export function recordRun(selection: Selection) {
  const usesAdminKeys = selection.mode === 'single' ? selection.single?.source === 'admin' : selection.agent.some((m) => m.source === 'admin')
  if (!usesAdminKeys) return
  const s = loadSettings()
  const today = new Date().toISOString().slice(0, 10)
  s.lastRunDate = today
  s.runsToday = s.lastRunDate === today ? s.runsToday + 1 : 1
  saveSettings(s)
}

export async function collectMaterial(exam: ExamRecord): Promise<{ text: string; images: ImagePart[] }> {
  const label = (side: string, items: ExamRecord['questions']) => items.map((item, i) =>
    item.type === 'text'
      ? `ITEM ${i + 1} (${side}) TEXT:\n${item.text}`
      : `ITEM ${i + 1} (${side}) IMAGE: ${item.name} [attached as image ${item.id}]`,
  )
  const text = [
    `PAPER NAME: ${exam.title || '(unnamed)'}`,
    `SUBJECT: ${exam.subject || '(unspecified)'}`,
    exam.totalMarks ? `DECLARED TOTAL MARKS: ${exam.totalMarks}` : 'DECLARED TOTAL MARKS: unknown — infer from the paper.',
    '',
    label('QUESTION SIDE', exam.questions).join('\n\n'),
    '',
    label('ANSWER SIDE', exam.answers).join('\n\n'),
  ].join('\n')
  const images: ImagePart[] = []
  for (const item of [...exam.questions, ...exam.answers]) {
    if (item.type === 'image') images.push({ mimeType: item.mimeType || item.blob.type || 'image/jpeg', dataUrl: await blobToDataUrl(item.blob) })
  }
  return { text, images }
}

export async function runExam(
  exam: ExamRecord,
  selection: Selection,
  onProgress: (e: ProgressEvent) => void,
): Promise<ExamRecord> {
  const models: ModelRef[] = selection.mode === 'single' ? [selection.single!] : selection.agent
  const { text, images } = await collectMaterial(exam)

  await saveExam({ ...exam, status: 'running', errorKey: undefined, errorDetail: undefined })
  recordRun(selection)

  let raw: Record<string, unknown>
  try {
    raw = selection.mode === 'single'
      ? await runSingleMode(models[0], text, images, onProgress)
      : await runAgentMode(models, text, images, onProgress)
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError('UNKNOWN', 'errors.unknown')
    await saveExam({ ...exam, status: 'failed', errorKey: err.i18nKey, errorDetail: err.detail })
    throw err
  }

  const report = normalizeReport(raw, selection.mode, models)

  // Persist result
  const done: ExamRecord = { ...exam, status: 'done', evaluation: report, errorKey: undefined, errorDetail: undefined }
  await saveExam(done)

  // Post-examination: heavily compress stored images to keep local storage small
  try {
    onProgress({ stage: 'finishing', detail: 'compress' })
    const compress = async (items: ExamRecord['questions']) => {
      const out: typeof items = []
      for (const item of items) {
        if (item.type === 'image') {
          const blob = await compressImage(item.blob, 'archive')
          out.push({ ...item, blob, size: blob.size, mimeType: blob.type })
        } else out.push(item)
      }
      return out
    }
    done.questions = await compress(done.questions)
    done.answers = await compress(done.answers)
    done.imagesCompressed = true
    await saveExam(done)
  } catch { /* compression is best-effort */ }

  return done
}

export async function loadExam(id: string): Promise<ExamRecord | undefined> {
  return getExam(id)
}
