import { useRef, useState } from 'react'
import {
  ArrowUpRight, Check, FileImage, FileText, ImagePlus, Layers3,
  LockKeyhole, Plus, Settings2, Sparkles, Upload, X
} from 'lucide-react'

type InputItem = {
  id: string
  type: 'text' | 'image'
  name?: string
  text?: string
  url?: string
}

type WorkspaceProps = {
  title: string
  description: string
  items: InputItem[]
  onAddImages: (files: FileList | null) => void
  onAddText: () => void
  onRemove: (id: string) => void
}

function Workspace({ title, description, items, onAddImages, onAddText, onRemove }: WorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <section className={`workspace ${dragging ? 'workspace--dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onAddImages(e.dataTransfer.files) }}
    >
      <div className="workspace__head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="count-pill">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
      </div>

      <div className="dropzone">
        <div className="dropzone__icon"><Upload size={20} /></div>
        <div className="dropzone__copy">
          <strong>Drop anything here</strong>
          <span>Images, text, or a mixture of both.</span>
        </div>
        <div className="dropzone__actions">
          <button className="button button--secondary" onClick={() => inputRef.current?.click()}>
            <ImagePlus size={16} /> Add photos
          </button>
          <button className="button button--secondary" onClick={onAddText}>
            <FileText size={16} /> Add text
          </button>
        </div>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e) => onAddImages(e.target.files)} />
      </div>

      {items.length > 0 && (
        <div className="item-grid">
          {items.map((item) => (
            <article className={`paper-item paper-item--${item.type}`} key={item.id}>
              <button className="remove-button" aria-label={`Remove ${item.name ?? 'text'}`} onClick={() => onRemove(item.id)}><X size={14} /></button>
              {item.type === 'image' ? (
                <>
                  <img src={item.url} alt={item.name ?? 'Uploaded paper'} />
                  <div className="item-meta"><FileImage size={14} /><span>{item.name}</span></div>
                </>
              ) : (
                <>
                  <div className="text-item__mark">T</div>
                  <p>{item.text}</p>
                  <div className="item-meta"><FileText size={14} /><span>Text block</span></div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [questions, setQuestions] = useState<InputItem[]>([])
  const [answers, setAnswers] = useState<InputItem[]>([])
  const [showSetup, setShowSetup] = useState(false)
  const [textTarget, setTextTarget] = useState<'questions' | 'answers' | null>(null)
  const [textValue, setTextValue] = useState('')

  const addImages = (target: 'questions' | 'answers', files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).filter(f => f.type.startsWith('image/')).map(file => ({
      id: crypto.randomUUID(), type: 'image' as const, name: file.name, url: URL.createObjectURL(file)
    }))
    target === 'questions' ? setQuestions(v => [...v, ...next]) : setAnswers(v => [...v, ...next])
  }

  const addText = (target: 'questions' | 'answers') => {
    setTextTarget(target)
    setTextValue('')
  }

  const commitText = () => {
    if (!textTarget || !textValue.trim()) return
    const item = { id: crypto.randomUUID(), type: 'text' as const, text: textValue.trim() }
    textTarget === 'questions' ? setQuestions(v => [...v, item]) : setAnswers(v => [...v, item])
    setTextTarget(null)
  }

  const remove = (target: 'questions' | 'answers', id: string) => {
    target === 'questions'
      ? setQuestions(v => v.filter(i => i.id !== id))
      : setAnswers(v => v.filter(i => i.id !== id))
  }

  const ready = questions.length > 0 && answers.length > 0

  return (
    <main className="app-shell">
      <nav className="topbar">
        <div className="brand">
          <div className="brand__mark"><Layers3 size={18} /></div>
          <span>Paper Examiner</span>
        </div>
        <div className="topbar__right">
          <span className="privacy"><LockKeyhole size={14} /> Stays on this device</span>
          <button className="icon-button" aria-label="Settings" onClick={() => setShowSetup(true)}><Settings2 size={18} /></button>
        </div>
      </nav>

      <div className="content">
        <header className="hero">
          <div className="hero__copy">
            <div className="eyebrow"><Sparkles size={14} /> Private AI evaluation workspace</div>
            <h1>Put in the paper.<br /><em>Get the verdict.</em></h1>
            <p>Drop the original questions and your solved work. Paper Examiner will later reconstruct the paper, run independent reviewers, and let a main agent adjudicate the result.</p>
          </div>
          <div className="hero__status">
            <div className="status-card">
              <span>Evaluation readiness</span>
              <strong>{ready ? 'Ready to review' : 'Add both papers'}</strong>
              <div className="status-line"><i className={ready ? 'is-ready' : ''} /></div>
            </div>
          </div>
        </header>

        <div className="workspace-stack">
          <Workspace title="Question Paper" description="Add the complete original paper in any order — photos, text, or both." items={questions}
            onAddImages={(files) => addImages('questions', files)} onAddText={() => addText('questions')} onRemove={(id) => remove('questions', id)} />
          <div className="flow-divider"><span>then</span><ArrowUpRight size={16} /></div>
          <Workspace title="Your Solution" description="Drop your complete submitted work. Don't split it into questions manually." items={answers}
            onAddImages={(files) => addImages('answers', files)} onAddText={() => addText('answers')} onRemove={(id) => remove('answers', id)} />
        </div>

        <section className="launch-card">
          <div>
            <div className="eyebrow">Phase 1 foundation</div>
            <h3>Everything ready? Let the examiner take over.</h3>
            <p>AI orchestration, BYOK providers, local persistence and the full report engine arrive in the next phases.</p>
          </div>
          <button className="button button--primary" disabled={!ready} onClick={() => setShowSetup(true)}>
            Configure examiner <ArrowUpRight size={17} />
          </button>
        </section>
      </div>

      {textTarget && (
        <div className="modal-backdrop" onMouseDown={() => setTextTarget(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__head"><div><div className="eyebrow">Add text</div><h3>{textTarget === 'questions' ? 'Question Paper' : 'Your Solution'}</h3></div><button className="icon-button" onClick={() => setTextTarget(null)}><X size={18}/></button></div>
            <textarea autoFocus value={textValue} onChange={e => setTextValue(e.target.value)} placeholder="Paste or type any part of the paper here..." />
            <div className="modal__foot"><button className="button button--secondary" onClick={() => setTextTarget(null)}>Cancel</button><button className="button button--primary" onClick={commitText}><Check size={16}/> Add text</button></div>
          </div>
        </div>
      )}

      {showSetup && (
        <div className="modal-backdrop" onMouseDown={() => setShowSetup(false)}>
          <div className="modal modal--setup" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__head"><div><div className="eyebrow">Coming next</div><h3>Examiner configuration</h3></div><button className="icon-button" onClick={() => setShowSetup(false)}><X size={18}/></button></div>
            <div className="setup-preview">
              <div><Check size={16}/><span>Multiple independent reviewers</span></div>
              <div><Check size={16}/><span>Main-agent adjudication, not averaging</span></div>
              <div><Check size={16}/><span>Gemini, OpenAI, Mistral, OpenRouter & Groq</span></div>
              <div><Check size={16}/><span>BYOK keys stored locally</span></div>
              <div><Check size={16}/><span>Reports saved entirely on this device</span></div>
            </div>
            <button className="button button--primary button--full" onClick={() => setShowSetup(false)}>Got it</button>
          </div>
        </div>
      )}
    </main>
  )
}
