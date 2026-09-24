/**
 * Canvas-based image compression (no dependencies).
 *  - On upload:  light compression (keeps AI accuracy, avoids 20-50MB payloads that cause 400/413)
 *  - After exam: heavy WebP compression (~100KB-class) to keep IndexedDB small
 */

export type CompressLevel = 'upload' | 'archive'

const LEVELS: Record<CompressLevel, { maxDim: number; quality: number; mime: string }> = {
  upload: { maxDim: 1600, quality: 0.82, mime: 'image/jpeg' },
  archive: { maxDim: 720, quality: 0.45, mime: 'image/webp' },
}

export async function compressImage(blob: Blob, level: CompressLevel): Promise<Blob> {
  const cfg = LEVELS[level]
  if (blob.type === 'image/gif' || blob.size < 120_000) return blob // don't touch tiny images or GIFs
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const scale = Math.min(1, cfg.maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, cfg.mime, cfg.quality))
    if (!out || out.size >= blob.size) return blob // compression made it bigger — keep original
    return out
  } catch {
    return blob // unreadable image — keep original, AI call will surface a clear error if truly broken
  }
}

export async function compressedDataUrl(blob: Blob, level: CompressLevel): Promise<string> {
  const compressed = await compressImage(blob, level)
  return blobToDataUrl(compressed)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
