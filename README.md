# Paper Examiner v0.2.0 — AI Exam Examiner

Upload a question paper + the student's answer sheet (photos or scans) and get an
AI-examined mark breakdown: per-question scores, strong points, weak points,
suggestions and recommendations — in any subject, any country, any language.
Works entirely in the browser. No backend, no server to run.

## What's new in v0.2.0 (full rebuild)

- **Fixed: API keys could not be added.** Config is now validated on load, keys are
  added with a proper form + "Test" button, model IDs are picked from dropdowns
  (never typed blind), and every save gives visible feedback.
- **Fixed: examination failing.** Images are compressed before upload (≈1600px JPEG)
  and archived as heavy WebP (~100KB) after grading; every AI call has a 120s timeout,
  status-aware retry with exponential backoff, and a rotating key pool
  (429 → 60s cooldown, 401/403 → key benched) with a full user-facing error matrix
  (400 / 401 / 403 / 429 / 5xx / timeout / network / bad-JSON).
- **Admin free-key system.** Hard-coded config file — no backend. See
  `src/config/examiner.config.ts`: the top of the file contains FULL copy-paste
  examples for every supported provider (Gemini, OpenAI, OpenRouter, Groq, Mistral,
  and any custom OpenAI-compatible endpoint). Add one or MANY keys per provider;
  the app rotates them automatically.
- **Model picker with two modes.** Users see all models (admin "Free" + their own
  keys) and choose **Single Model** or **Agent** mode (2–3 models grade the paper
  as a committee: reconstruct → 3 cross-model reviewers → main adjudicator).
- **Exam page persisted.** `/examine/:id` runs the grading session with live stage
  progress; state is persisted in localStorage + IndexedDB, so a refresh never
  loses the exam.
- **Code-rendered animated report.** `/report/:id` renders the AI verdict as real
  UI (score ring with count-up, radar, staggered cards) — never raw AI text.
  Report language auto-follows the language of the paper/answers.
- **5 UI languages** via the language button popup: English, বাংলা, हिन्दी, Español,
  العربية (RTL).
- **SEO pack**: meta/OG/Twitter tags, hreflang, JSON-LD (WebApplication + FAQ),
  `sitemap.xml`, `robots.txt`, keyword targeting for "Exam Examiner",
  "Online Exam Examiner", "AI Exam Examiner", "Free Exam Examiner Online" in all
  5 app languages.

## v0.2.1 patch

Smarter network diagnostics: when an AI call fails at the browser level the app now
tells you *why* — offline, opened as a local file (file://), provider geo-blocked
(400 FAILED_PRECONDITION, e.g. Gemini in unsupported regions), or a
blocked connection (VPN / ad-blocker / antivirus / ISP). Messages are localized in
all 5 languages and include the provider's own error detail.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Add your free keys (admin)

1. Open `src/config/examiner.config.ts`.
2. Copy one of the FULL EXAMPLES at the top of that file.
3. Paste your real API key(s) and model ID(s) into `ADMIN_PROVIDERS`.
4. Save → rebuild/redeploy. Users instantly see your models marked **Free**.

## Deploy

**Option A — Git (recommended):** push this folder to GitHub, connect the repo to
Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`

**Option B — Drag & drop:** the `dist/` folder in this project is a fresh production
build. Zip its *contents* and drop it on <https://pages.cloudflare.com>.

## Routes

| Route           | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `/`             | Home: upload paper + answers, pick models, launch     |
| `/examine/:id`  | Live grading session (persisted, resumable)           |
| `/report/:id`   | Animated mark breakdown report                        |
| `/docs`         | How it works / FAQ                                    |
| `/about`        | About + privacy-friendly architecture note            |
| `/privacy`      | Privacy policy                                        |

Admin controls: permanent keys/models live in `src/config/examiner.config.ts`;
live key-pool health (active / cooling down / benched, last errors) is visible in
the in-app Settings (gear icon) → Keys tab.

## Tech

Vite · React 19 · TypeScript · react-router · framer-motion · IndexedDB ·
provider adapters for Gemini + any OpenAI-compatible API.
