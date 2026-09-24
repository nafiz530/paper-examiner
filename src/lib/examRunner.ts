import { getExam, saveExam, type ExamRecord } from '../db'
import { compressImage } from './compress'
import { blobToDataUrl } from './compress'
import { loadSettings, saveSettings, type ModelRef, type Selection } from './settings'
import { ADMIN_SETTINGS } from '../config/examiner.config'
import { runExamination } from './pipeline'
import { AIError } from './aiErrors'
import type { ProgressEvent } from './pipeline'
import type { ImagePart } from './providers'

/** Friendly client-side daily cap for the shared tier. The REAL limit is enforced server-side (per-IP rate limit). */
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
  // (previous version assigned lastRunDate BEFORE comparing it, so the counter was always reset to 1)
  s.runsToday = s.lastRunDate === today ? s.runsToday + 1 : 1
  s.lastRunDate = today
  saveSettings(s)
}

/**
 * Build the raw material text. Images are numbered IMAGE 1..N across both sides in
 * attachment order, so the extraction phase can route per-question images precisely
 * (see pickImages() in pipeline.ts).
 */
export async function collectMaterial(exam: ExamRecord): Promise<{ text: string; images: ImagePart[] }> {
  const imageItems: Array<ExamRecord['questions'][number] & { type: 'image' }> = []
  const lines: string[] = [
    `PAPER NAME: ${exam.title || '(unnamed)'}`,
    `SUBJECT: ${exam.subject || '(unspecified)'}`,
    exam.totalMarks ? `DECLARED TOTAL MARKS: ${exam.totalMarks}` : 'DECLARED TOTAL MARKS: unknown — infer from the paper.',
    '',
  ]

  const side = (name: string, items: ExamRecord['questions']) => {
    lines.push(`${name}:`)
    if (items.length === 0) {
      lines.push('(no items)')
    } else {
      items.forEach((item, i) => {
        if (item.type === 'text') {
          lines.push(`- TEXT ITEM ${i + 1}: ${item.text}`)
        } else {
          const imageNo = imageItems.length + 1
          imageItems.push(item)
          lines.push(`- IMAGE ${imageNo}: ${item.name} (${name === 'ANSWER SIDE' ? 'answer' : 'question'} photo)`)
        }
      })
    }
    lines.push('')
  }

  side('QUESTION SIDE', exam.questions)
  side('ANSWER SIDE', exam.answers)

  lines.push(imageItems.length > 0
    ? `All ${imageItems.length} image(s) are attached to this request in the order IMAGE 1 … IMAGE ${imageItems.length}.`
    : 'No images are attached to this request (all material is text).')

  const dataUrls = await Promise.all(imageItems.map((item) => blobToDataUrl(item.blob)))
  const images: ImagePart[] = imageItems.map((item, i) => ({
    mimeType: item.mimeType || item.blob.type || 'image/jpeg',
    dataUrl: dataUrls[i],
  }))

  return { text: lines.join('\n'), images }
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

  let report
  try {
    report = await runExamination({
      mode: selection.mode,
      models,
      material: text,
      images,
      declaredTotal: exam.totalMarks ?? null,
      onProgress,
    })
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError('UNKNOWN', 'errors.unknown')
    await saveExam({ ...exam, status: 'failed', errorKey: err.i18nKey, errorDetail: err.detail })
    throw err
  }

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
