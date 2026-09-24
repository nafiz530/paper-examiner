/**
 * SERVER-ONLY configuration for the "Provided for you" tier.
 *
 * This file contains NO secrets. Keys live in Cloudflare encrypted environment
 * variables (Pages → Settings → Variables and Secrets) and are referenced here by NAME.
 *
 * Nothing under functions/ is ever bundled into the browser build.
 */
import type { ProxyProviderType } from '../../shared/aiWire'

export type ServerProvider = {
  /** stable id the browser refers to */
  id: string
  type: ProxyProviderType
  /** shown to users in the model picker */
  label: string
  /** name of the Cloudflare env var holding this provider's key(s), comma or newline separated */
  keysEnv: string
  /** the ONLY models this key may be used with (allowlist) */
  models: string[]
  enabled: boolean
}

export const SERVER_PROVIDERS: ServerProvider[] = [
  {
    id: 'gemini-free',
    type: 'gemini',
    label: 'Google Gemini (Free)',
    keysEnv: 'GEMINI_KEYS',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    enabled: true,
  },
  {
    id: 'openrouter-free',
    type: 'openrouter',
    label: 'OpenRouter (Free models)',
    keysEnv: 'OPENROUTER_KEYS',
    models: ['deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen-2.5-72b-instruct:free'],
    enabled: false,
  },
  // Add more providers here. Never put a key in this file.
]

/** Hard server-side limits. These are enforced regardless of what the browser sends. */
export const LIMITS = {
  /** whole JSON request body */
  maxBodyBytes: 12 * 1024 * 1024,
  /** number of images per call */
  maxImages: 12,
  /** decoded size of any single image (approx, from base64 length) */
  maxImageBytes: 4 * 1024 * 1024,
  /** cap on system + user text */
  maxTextChars: 400_000,
  /** clamp on requested output tokens */
  maxTokens: 8192,
  /** upstream timeout */
  upstreamTimeoutMs: 100_000,
}

export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/**
 * Per-IP rate limit for the proxy (best-effort, per Cloudflare isolate — see functions/_lib/ratelimit.ts).
 * For a hard guarantee also add a Cloudflare WAF rate-limiting rule on /api/* (see the comments in this file).
 */
export const RATE_LIMIT = {
  /** AI calls per window per IP. One "exam" is 1 call (single) or ~6 calls (agent), so this is generous. */
  maxCalls: 40,
  windowSec: 3600,
}

/** Env var names (bindings) the functions read. Set them in the Cloudflare dashboard. */
export type Env = {
  GEMINI_KEYS?: string
  OPENROUTER_KEYS?: string
  OPENAI_KEYS?: string
  GROQ_KEYS?: string
  MISTRAL_KEYS?: string
  /** Comma-separated list of allowed browser origins, e.g. "https://paper-examiner.pages.dev,https://exam.example.com". */
  ALLOWED_ORIGINS?: string
  /** Optional Cloudflare Turnstile. Needs BOTH keys AND TURNSTILE_ENFORCE="1" (see turnstile.ts — the SPA widget is not shipped yet). */
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET?: string
  TURNSTILE_ENFORCE?: string
  /** Optional KV namespace for a durable rate limiter (falls back to in-memory if unbound). */
  RATE_KV?: KVNamespaceLike
  [name: string]: unknown
}

/** Minimal KV shape so this file has no dependency on @cloudflare/workers-types. */
export type KVNamespaceLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}
