/* =====================================================================================
 *  ███ ADMIN CONFIGURATION FILE ███  —  THIS IS THE ONLY FILE YOU EDIT AS ADMIN
 * =====================================================================================
 *  Everything below is static (no backend). Keys here are shipped with the app and are
 *  visible in the browser network tab — that is accepted by design (you cap usage limits).
 *
 *  HOW TO USE — 3 STEPS:
 *    1. Pick provider examples from the "FULL EXAMPLES" block below.
 *    2. Fill ADMIN_PROVIDERS with your real API key(s) + exact model ID(s).
 *    3. Save. Rebuild / redeploy. Users instantly see "Free" models in the model picker.
 *
 *  You can add the SAME provider twice with different keys (a key pool = higher rate
 *  limits: the app rotates keys automatically and cools down keys that hit 429).
 * =====================================================================================
 *
 *  ┌───────────────────────────── FULL EXAMPLES — ALL POSSIBLE PROVIDERS ─────────────────────────────┐
 *  │                                                                                                   │
 *  │  1) GOOGLE GEMINI  (free tier, excellent vision/handwriting OCR)                                   │
 *  │     type: 'gemini'   key from: https://aistudio.google.com/apikey                                  │
 *  │     { id:'gemini-1', type:'gemini', label:'Google Gemini (Free)', keys:['AIzaSy...'],              │
 *  │       models:['gemini-3.8-flash','gemini-3.5-flash-lite'], enabled:true }                               │
 *  │                                                                                                   │
 *  │  2) OPENAI  (paid, very strong)                                                                    │
 *  │     type: 'openai'   key from: https://platform.openai.com/api-keys                                │
 *  │     { id:'openai-1', type:'openai', label:'OpenAI', keys:['sk-proj-...'],                          │
 *  │       models:['gpt-4o','gpt-4o-mini'], enabled:true }                                              │
 *  │                                                                                                   │
 *  │  3) OPENROUTER  (ONE key = 100+ models, many free ones)                                            │
 *  │     type: 'openrouter'   key from: https://openrouter.ai/keys                                      │
 *  │     { id:'openrouter-1', type:'openrouter', label:'OpenRouter', keys:['sk-or-v1-...'],             │
 *  │       models:['deepseek/deepseek-chat-v3-0324:free','qwen/qwen-2.5-72b-instruct:free',             │
 *  │               'meta-llama/llama-3.3-70b-instruct:free'], enabled:true }                            │
 *  │                                                                                                   │
 *  │  4) GROQ  (free tier, extremely fast, Llama models)                                                │
 *  │     type: 'groq'   key from: https://console.groq.com/keys                                         │
 *  │     { id:'groq-1', type:'groq', label:'Groq (Free)', keys:['gsk_...'],                             │
 *  │       models:['llama-3.3-70b-versatile','meta-llama/llama-4-scout-17b-16e-instruct'],              │
 *  │       enabled:true }                                                                               │
 *  │     NOTE: Groq text models cannot read images. Use a Groq vision model for scans.                  │
 *  │                                                                                                   │
 *  │  5) MISTRAL  (free experiment tier available)                                                      │
 *  │     type: 'mistral'   key from: https://console.mistral.ai/api-keys                                │
 *  │     { id:'mistral-1', type:'mistral', label:'Mistral', keys:['...'],                               │
 *  │       models:['mistral-large-latest','pixtral-large-latest'], enabled:true }                       │
 *  │     NOTE: only Pixtral models can read images.                                                     │
 *  │                                                                                                   │
 *  │  6) CUSTOM — ANY OpenAI-compatible endpoint (DeepSeek, SiliconFlow, Together, Ollama, LM Studio…)  │
 *  │     type: 'custom'  +  baseURL must end with /v1 (the app appends /chat/completions)               │
 *  │     { id:'deepseek-1', type:'custom', label:'DeepSeek', baseURL:'https://api.deepseek.com/v1',     │
 *  │       keys:['sk-...'], models:['deepseek-chat','deepseek-reasoner'], enabled:true }                │
 *  │     { id:'local-1', type:'custom', label:'My Ollama', baseURL:'http://localhost:11434/v1',         │
 *  │       keys:['ollama'], models:['llava:13b'], enabled:false }                                       │
 *  │                                                                                                   │
 *  └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export type ProviderType = 'gemini' | 'openai' | 'openrouter' | 'groq' | 'mistral' | 'custom'

export type AdminProvider = {
  /** unique id, any string, must not repeat */
  id: string
  type: ProviderType
  /** shown to users in the model picker */
  label: string
  /** ONLY for type 'custom': OpenAI-compatible base URL ending with /v1 */
  baseURL?: string
  /** 🔑 one or MANY keys — the app rotates them automatically (429 cooldown pool) */
  keys: string[]
  /** exact model IDs offered to users under this provider */
  models: string[]
  /** false = hidden from the app entirely */
  enabled: boolean
}

/* ══════════════════ EDIT BELOW — YOUR REAL PROVIDERS, KEYS AND MODELS ══════════════════ */

export const ADMIN_PROVIDERS: AdminProvider[] = [
  {
    id: 'gemini-free',
    type: 'gemini',
    label: 'Google Gemini (Free)',
    keys: ['PASTE_YOUR_GEMINI_API_KEY_1', 'PASTE_YOUR_GEMINI_API_KEY_2'],
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    enabled: true,
  },
  {
    id: 'openrouter-free',
    type: 'openrouter',
    label: 'OpenRouter (Free models)',
    keys: ['PASTE_YOUR_OPENROUTER_KEY'],
    models: ['deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen-2.5-72b-instruct:free'],
    enabled: false,
  },
  // Copy any example block from above and paste it here to add more providers…
]

/* ══════════════════ GENERAL ADMIN SETTINGS ══════════════════ */

export const ADMIN_SETTINGS = {
  /** shown under the "Free" badge in the model picker */
  freeTierLabel: 'Provided for you',
  /** gentle client-side cap: max AI examinations per browser per day on admin keys */
  freeExamsPerDay: 25,
  /** max models a user may select at once in Agent mode */
  maxAgentModels: 3,
}
