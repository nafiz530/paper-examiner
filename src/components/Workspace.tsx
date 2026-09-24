import { useRef, useState } from 'react'
import { FileImage, FileText, ImagePlus, Upload } from 'lucide-react'
import type { PaperItem, PaperSide } from '../db'
import { itemToPreviewUrl } from '../db'
import { compressImage, formatBytes } from '../lib/compress'
import { useI18n } from '../i18n'

export function Workspace({ title, description, side, items, onChange }: {
  title: string
  description: string
  side: PaperSide
  items: PaperItem[]
  onChange: (items: PaperItem[]) => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const addImages = async (files: FileList | null) => {
    if (!files) return
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    const next: PaperItem[] = []
    for (const f of images) {
      const blob = await compressImage(f, 'upload') // light compression keeps AI accuracy, kills 400/413 payload errors
      next.push({ id: crypto.randomUUID(), type: 'image', blob, name: f.name, mimeType: blob.type || f.type, size: blob.size, createdAt: Date.now() })
    }
    onChange([...items, ...next])
    if (inputRef.current) inputRef.current.value = ''
  }

  const addText = () => {
    const text = window.prompt(side === 'questions' ? t('home.qTitle') : t('home.aTitle'))
    if (text?.trim()) onChange([...items, { id: crypto.randomUUID(), type: 'text', text: text.trim(), createdAt: Date.now() }])
  }

  const move = (i: number, d: -1 | 1) => {
    const n = [...items]
    const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]
    onChange(n)
  }

  return (
    <section
      className={'workspace ' + (dragging ? 'workspace--dragging' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void addImages(e.dataTransfer.files) }}
    >
      <div className="workspace__head">
        <div><div className="eyebrow">Workspace</div><h2>{title}</h2><p>{description}</p></div>
        <span className="count-pill">{t('items.count', { n: items.length })}</span>
      </div>
      <div className="dropzone">
        <div className="dropzone__icon"><Upload size={20} /></div>
        <div className="dropzone__copy"><strong>{t('drop.title')}</strong><span>{t('drop.sub')}</span></div>
        <div className="dropzone__actions">
          <button className="button" onClick={() => inputRef.current?.click()}><ImagePlus size={16} /> {t('drop.addPhotos')}</button>
          <button className="button" onClick={addText}><FileText size={16} /> {t('drop.addText')}</button>
        </div>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e) => void addImages(e.target.files)} />
      </div>
      {items.length > 0 && (
        <div className="item-grid">
          {items.map((item, i) => {
            const url = itemToPreviewUrl(item)
            return (
              <article className={'paper-item paper-item--' + item.type} key={item.id}>
                <div className="item-tools">
                  <button disabled={i === 0} aria-label="Move earlier" onClick={() => move(i, -1)}>↑</button>
                  <button disabled={i === items.length - 1} aria-label="Move later" onClick={() => move(i, 1)}>↓</button>
                  <button aria-label="Remove item" onClick={() => onChange(items.filter((x) => x.id !== item.id))}>×</button>
                </div>
                {item.type === 'image'
                  ? <>
                      {url && <img src={url} alt={item.name} />}
                      <div className="item-meta"><FileImage size={14} /><span title={item.name}>{item.name}</span><em>{formatBytes(item.size)}</em></div>
                    </>
                  : <>
                      <div className="text-item__mark">T</div>
                      <p>{item.text}</p>
                      <div className="item-meta"><FileText size={14} /><span>Text block</span></div>
                    </>}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
