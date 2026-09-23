import type { EvaluationResult } from './evaluation'

export type PaperSide = 'questions' | 'answers'
export type PaperItem =
  | { id:string; type:'image'; blob:Blob; name:string; mimeType:string; size:number; createdAt:number }
  | { id:string; type:'text'; text:string; createdAt:number }

export type ExamRecord = {
  id:string
  title:string
  subject:string
  totalMarks:number|null
  createdAt:number
  updatedAt:number
  questions:PaperItem[]
  answers:PaperItem[]
  evaluation?: EvaluationResult
}

const DB_NAME='paper-examiner', DB_VERSION=2, STORE='exams'

function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION)
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})}
    r.onsuccess=()=>resolve(r.result)
    r.onerror=()=>reject(r.error??new Error('Could not open local database'))
  })
}
export async function saveExam(exam:ExamRecord){
  const db=await openDb()
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    tx.objectStore(STORE).put(exam)
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error??new Error('Could not save exam'))}
  })
}
export async function getExam(id:string):Promise<ExamRecord|undefined>{
  const db=await openDb()
  return new Promise((resolve,reject)=>{
    const r=db.transaction(STORE,'readonly').objectStore(STORE).get(id)
    r.onsuccess=()=>{db.close();resolve(r.result)}
    r.onerror=()=>{db.close();reject(r.error??new Error('Could not read exam'))}
  })
}
export async function deleteExam(id:string){
  const db=await openDb()
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error??new Error('Could not delete exam'))}
  })
}
export function itemToPreviewUrl(item:PaperItem){return item.type==='image'?URL.createObjectURL(item.blob):undefined}
