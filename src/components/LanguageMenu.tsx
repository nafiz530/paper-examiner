import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { LANGUAGES, useI18n, type Lang } from '../i18n'

export function LanguageMenu() {
  const { lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]

  return (
    <div className="lang-menu" ref={ref}>
      <button className="text-button lang-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Languages size={15} />
        <span className="lang-trigger__native">{current.native}</span>
        <ChevronDown size={14} className={open ? 'rot-up' : ''} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="lang-list"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {LANGUAGES.map((l) => (
              <li key={l.code}>
                <button
                  role="option"
                  aria-selected={l.code === lang}
                  className={'lang-list__item ' + (l.code === lang ? 'is-active' : '')}
                  onClick={() => { setLang(l.code as Lang); setOpen(false) }}
                >
                  <span className="lang-list__flag">{l.flag}</span>
                  <span className="lang-list__native">{l.native}</span>
                  <span className="lang-list__english">{l.english}</span>
                  {l.code === lang && <Check size={15} />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
