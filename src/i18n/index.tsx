import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type Copy } from './en'
import { bn } from './bn'
import { hi } from './hi'
import { es } from './es'
import { ar } from './ar'

export type Lang = 'en' | 'bn' | 'hi' | 'es' | 'ar'

export const LANGUAGES: Array<{ code: Lang; native: string; english: string; flag: string }> = [
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧' },
  { code: 'bn', native: 'বাংলা', english: 'Bangla', flag: '🇧🇩' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  { code: 'ar', native: 'العربية', english: 'Arabic', flag: '🇸🇦' },
]

const COPIES: Record<Lang, Copy> = { en, bn, hi, es, ar }
const RTL: Lang[] = ['ar']
const LANG_KEY = 'paper-examiner-lang'

/** BCP-47 names for the "report language" line (AI may return any code). */
const LANG_NAMES: Record<string, string> = {
  en: 'English', bn: 'বাংলা (Bangla)', hi: 'हिन्दी (Hindi)', es: 'Español', ar: 'العربية (Arabic)',
  ur: 'اردو (Urdu)', fr: 'Français', de: 'Deutsch', pt: 'Português', ru: 'Русский', zh: '中文', ja: '日本語', ko: '한국어', id: 'Bahasa Indonesia', tr: 'Türkçe', ta: 'தமிழ்', te: 'తెలుగు', mr: 'मराठी', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ', it: 'Italiano', fa: 'فارسی', sw: 'Kiswahili', vi: 'Tiếng Việt', th: 'ไทย', nl: 'Nederlands', pl: 'Polski', uk: 'Українська', he: 'עברית', hi_latn: 'Hindi',
}

export function langName(code: string): string {
  const base = code.split('-')[0].toLowerCase()
  return LANG_NAMES[base] ?? LANG_NAMES[code] ?? code
}

type I18nContext = {
  lang: Lang
  dir: 'ltr' | 'rtl'
  t: (key: keyof Copy, vars?: Record<string, string | number>) => string
  setLang: (l: Lang) => void
}

const Ctx = createContext<I18nContext | null>(null)

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null
    if (stored && stored in COPIES) return stored
    const nav = navigator.language.slice(0, 2).toLowerCase()
    if (nav in COPIES) return nav as Lang
  } catch { /* SSR-safe */ }
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  useEffect(() => {
    const dir = RTL.includes(lang) ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try { localStorage.setItem(LANG_KEY, lang) } catch { /* non fatal */ }
    // per-language document metadata (SEO for SPA)
    const meta = SEO_META[lang]
    if (meta) {
      document.title = meta.title
      const desc = document.querySelector('meta[name="description"]')
      if (desc) desc.setAttribute('content', meta.description)
    }
  }, [lang])

  const setLang = useCallback((l: Lang) => setLangState(l), [])

  const t = useCallback((key: keyof Copy, vars?: Record<string, string | number>) => {
    let s: string = COPIES[lang][key] ?? en[key] ?? String(key)
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
    return s
  }, [lang])

  const value = useMemo<I18nContext>(() => ({ lang, dir: RTL.includes(lang) ? 'rtl' : 'ltr', t, setLang }), [lang, t, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18nContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}

/** Per-language SEO metadata (title + description carry the target keywords). */
export const SEO_META: Record<Lang, { title: string; description: string }> = {
  en: {
    title: 'Paper Examiner — Free AI Exam Examiner Online | Online Exam Examiner',
    description: 'Free online AI exam examiner: examine any paper, any subject, any country, any language. Upload questions + answers, get an AI mark breakdown with strengths, weaknesses, suggestions and recommendations.',
  },
  bn: {
    title: 'Paper Examiner — ফ্রি অনলাইন AI পরীক্ষা পরীক্ষক | Exam Examiner',
    description: 'ফ্রি অনলাইন AI পরীক্ষা পরীক্ষক: যেকোনো বিষয়, দেশ ও ভাষার খাতা মূল্যায়ন। প্রশ্নপত্র ও উত্তর আপলোড করুন — নম্বর বিশ্লেষণ, ভালো দিক, দুর্বলতা, পরামর্শ ও সুপারিশ সহ পূর্ণ রিপোর্ট পান।',
  },
  hi: {
    title: 'Paper Examiner — मुफ़्त ऑनलाइन AI परीक्षा परीक्षक | Exam Examiner',
    description: 'मुफ़्त ऑनलाइन AI परीक्षा परीक्षक: किसी भी विषय, देश और भाषा की जाँच। प्रश्न और उत्तर अपलोड करें — अंक विश्लेषण, अच्छे पक्ष, कमज़ोरियाँ, सुझाव और अनुशंसाओं के साथ पूरी रिपोर्ट पाएँ।',
  },
  es: {
    title: 'Paper Examiner — Examinador de exámenes IA gratis online',
    description: 'Examinador de exámenes online gratis con IA: corrige cualquier examen, materia, país e idioma. Sube preguntas y respuestas y recibe desglose de notas, puntos fuertes, débiles, sugerencias y recomendaciones.',
  },
  ar: {
    title: 'Paper Examiner — ممتحن امتحانات ذكي مجاني أونلاين',
    description: 'ممتحن امتحانات ذكي مجاني أونلاين: امتحن أي ورقة وأي مادة وأي دولة وأي لغة. ارفع الأسئلة والإجابات واحصل على تفصيل الدرجات ونقاط القوة والضعف والاقتراحات والتوصيات.',
  },
}
