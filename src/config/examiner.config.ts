/* =====================================================================================
 *  CLIENT-SIDE CONFIGURATION  —  contains NO secrets, by design.
 * =====================================================================================
 *  This file is bundled into the browser. Anything written here is PUBLIC.
 *
 *  ⚠  NEVER paste an API key into this project's source code. A key in a static site is
 *     readable by anyone (View Source / Network tab) and is scraped from public GitHub
 *     within minutes — exactly how the previous Gemini key got disabled as "leaked".
 *
 *  Where do keys go now?
 *    • "Provided for you" (shared) models →  Cloudflare encrypted environment variables,
 *      configured in the dashboard. The provider/model allowlist lives in
 *      functions/_lib/config.ts (server-only, contains no secrets).
 *    • BYOK (users' own keys)             →  typed into Settings in the browser and stored
 *      only in that user's localStorage; sent only to the provider they chose.
 * ===================================================================================== */

export type ProviderType = 'gemini' | 'openai' | 'openrouter' | 'groq' | 'mistral' | 'custom'

export const ADMIN_SETTINGS = {
  /** shown under the "Free" badge in the model picker */
  freeTierLabel: 'Provided for you',
  /** gentle client-side cap (UX only): max AI examinations per browser per day on the shared tier.
   *  The real, enforced limit is the server-side per-IP rate limit (functions/_lib/config.ts). */
  freeExamsPerDay: 25,
  /** max models a user may select at once in Agent mode */
  maxAgentModels: 3,
}
