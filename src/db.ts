import type { UnifiedReport } from './lib/pipeline'

export type PaperSide = 'questions' | 'answers'
export type PaperItem =
  | { id: string; type: 'image'; blob: Blob; name: string; mimeType: string; size: number; createdAt: number }
  | { id: string; type: 'text'; text: string; createdAt: number }

export type ExamStatus = 'draft' | 'running' | 'done' | 'failed'

export type ExamRecord = {
  id: string
  title: string
  subject: string
  totalMarks: number | null
  status: ExamStatus
  createdAt: number
  updatedAt: number
  questions: PaperItem[]
  answers: PaperItem[]
  imagesCompressed?: boolean
  evaluation?: UnifiedReport
  errorKey?: string
  errorDetail?: string
}

const DB_NAME = 'paper-examiner', DB_VERSION = 3, STORE = 'exams'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      // v2 → v3: nothing structural; status/evaluation live inside the records
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('Could not open local database'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Database error')) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Database aborted')) }
  })
}

export function saveExam(exam: ExamRecord): Promise<IDBValidKey> {
  return withStore('readwrite', (s) => s.put({ ...exam, updatedAt: Date.now() }))
}

export function getExam(id: string): Promise<ExamRecord | undefined> {
  return withStore('readonly', (s) => s.get(id) as IDBRequest<ExamRecord | undefined>)
}

export function deleteExam(id: string): Promise<undefined> {
  return withStore('readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

export function listExams(): Promise<ExamRecord[]> {
  return withStore('readonly', (s) => s.getAll() as IDBRequest<ExamRecord[]>).then((rows) =>
    rows.sort((a, b) => b.updatedAt - a.updatedAt),
  )
}

let previewUrls = new WeakMap<Blob, string>()
export function itemToPreviewUrl(item: PaperItem): string | undefined {
  if (item.type !== 'image') return undefined
  const existing = previewUrls.get(item.blob)
  if (existing) return existing
  const url = URL.createObjectURL(item.blob)
  previewUrls.set(item.blob, url)
  return url
}
