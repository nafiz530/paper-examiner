# Paper Examiner v0.3.0 — AI Exam Examiner

Upload a question paper + the student's answer sheet (photos or text) and get an
AI-examined mark breakdown: per-question scores, strong points, weak points,
suggestions and recommendations — in any subject, any country, any language.
Works entirely in the browser. No backend, no server to run.

## What's new in v0.3.0 — the Examiner Harness overhaul

Read the full engineering rationale in **`ROADMAP.md`**. Highlights:

- **Marking accuracy rebuilt.** Both modes now run a staged harness instead of
  one giant pass: *extraction* (canonical question list + answer mapping +
  per-question image routing) → *focused marking* (small batches, only the
  relevant images attached) → *dispute adjudication* (agent mode) → *coaching*.
- **The score bug is dead.** `obtainedMarks`, `totalMarks`, `percentage` and the
  grade letter are **computed in TypeScript from the per-question breakdown** —
  the LLM never does arithmetic, so the header can never disagree with the list
  (the old app could show 16/20 over a 13/20 breakdown).
- **Consistency + coverage enforcement.** Marks are clamped to each question's
  maximum, verdict/marks contradictions are auto-corrected, and every extracted
  question appears in the report exactly once.
- **Agent committee, smarter.** 3 independent reviewers (Strict / Fair / Error
  hunter, spread across your selected models) → per-question median → only the
  genuinely disputed questions go to the adjudicator.
- **Token usage, no cost math.** Every call's real usage (Gemini
  `usageMetadata`, OpenAI-compatible `usage`, proxy-forwarded usage) is tracked
  and shown live during examination and in the report: totals, by phase
  (extract / grade / review / adjudicate / coach), by model, call count. When a
  provider hides usage, a clearly-marked ≈ estimate is shown.
- **New defaults.** Agent mode is the default; when the admin provides free
  models they are auto-selected until you add your own key or pick your own
  models — then your choice always wins.
- **Better UI.** Live per-question result chips and a token meter in the
  pipeline overlay, verdict filter chips + expand-all + mistakes/correct-steps
  per question, JSON export / print / copy-summary, confetti at ≥80%, richer
  animations everywhere.

## v0.2.x (previous releases)

- API keys added through a validated form with model dropdowns and a Test button.
- Images compressed before upload (≈1600px JPEG) and archived as heavy WebP
  after grading; 120s timeouts, status-aware retry with exponential backoff, and
  a rotating key pool with a full user-facing error matrix.
- Admin free-key system via Cloudflare encrypted environment variables.
- Exam page persisted (localStorage + IndexedDB) — a refresh never loses the exam.
- Code-rendered animated report; report language auto-follows the paper.
- 5 UI languages (English, বাংলা, हिन्दी, Español, العربية) + SEO pack.
- v0.2.1: smarter network diagnostics; v0.2.2: official `@google/genai` SDK,
  Gemini 3.x-safe configs, safety-block and truncation surfaced as real errors.

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
