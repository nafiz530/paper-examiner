# Paper Examiner v0.3.0 — Examiner Harness Overhaul Roadmap

This is the complete engineering roadmap for upgrading Paper Examiner from v0.2.x to
v0.3.0. It is organized around one goal: **drastically improve marking accuracy in
Single Mode and Agent Mode, and make every number in the report trustworthy.**

---

## 1. Diagnosis — why marking quality is bad today

### 1.1 Single Mode (~90% bad)

The current single mode makes **one giant AI call**: the model receives every page
image plus all typed text and must simultaneously (a) discover every question and
its sub-parts, (b) locate the matching student answer for each, (c) grade it, and
(d) write coaching advice — all in a single pass with a single JSON response.

That is four cognitively different jobs competing for one context window. What
fails in practice:

| Failure | Cause |
|---|---|
| Questions missed or merged (Q১(ক)/(খ) collapsed into one) | No canonical question list is ever established; the model re-derives structure while grading |
| Answers matched to the wrong question | Question↔answer mapping is implicit, done from memory inside the same pass |
| Marks invented (5/4, 3/2) | No machine-enforced mark caps |
| Total ≠ Σ per-question marks | The LLM computes the total itself and hallucinates arithmetic |
| Output truncated → bad JSON → retries → failure | One massive JSON output with `maxTokens: 8000` |

### 1.2 Agent Mode (~30% bad)

Agent mode already splits reconstruction → review → adjudication, which is why it
is better. But it still has four structural defects:

1. **LLM-computed totals** — `obtainedMarks` comes from the adjudicator's JSON, not
   from summing the per-question marks. This is exactly the reported bug: breakdown
   sums to 13/20 while the header says 16/20.
2. **Reviewers re-do everything in one pass** — each reviewer gets the full paper
   and grades all questions at once, re-introducing the single-mode weakness.
3. **All images go to every call** — no per-question image routing, so the model
   must re-orient itself across mixed pages every time.
4. **No coverage or consistency validation** — a question silently dropped by the
   adjudicator just disappears from the report.

### 1.3 What must change architecturally

> **Principle: the LLM never does arithmetic, never assigns totals, and never has
> to hold question-structure in its head while grading.**

The fix is a proper *harness*: a staged pipeline where each AI call has ONE job, a
tight schema, only the context it needs — and all aggregation happens in
deterministic TypeScript code.

---

## 2. The new examiner harness (v0.3.0)

### 2.1 Pipeline shape (both modes)

```
┌────────────────────────────────────────────────────────────────────┐
│ Phase 1 · EXTRACT (1 call, primary model, all images)              │
│   → canonical question list: number, prompt, sub-parts, maxMarks,  │
│     mapped student answer + which IMAGE #s contain it              │
│   → client validation: non-empty, marks sum vs declared total      │
├────────────────────────────────────────────────────────────────────┤
│ Phase 2 · GRADE                                                     │
│   Single mode: batches of ≤4 questions per call, run in parallel.  │
│     Each call sees ONLY its questions, their mapped answers,       │
│     and the images the extractor routed to them.                   │
│   Agent mode: 3 independent reviewers (roles: Strict / Fair /      │
│     Error-hunter, round-robin over the selected models) each       │
│     grade in batches of ≤8, in parallel.                            │
├────────────────────────────────────────────────────────────────────┤
│ Phase 3 · RECONCILE (agent mode only)                              │
│   Client-side first: per-question median of reviewer marks.        │
│   Questions where reviewers disagree beyond tolerance              │
│   (spread > max(1 mark, 15% of maxMarks)) go to ONE focused        │
│   adjudication call with each reviewer's evidence attached.        │
├────────────────────────────────────────────────────────────────────┤
│ Phase 4 · COACH (1 call, no images, no marks decisions)            │
│   → summary, strengths, weaknesses, suggestions,                   │
│     recommendations, topic mastery, confidence                     │
├────────────────────────────────────────────────────────────────────┤
│ Phase 5 · AGGREGATE (pure TypeScript, zero LLM)                    │
│   • awardedMarks clamped to 0..maxMarks                            │
│   • verdict↔marks consistency (correct ⇒ full marks;               │
│     unanswered ⇒ 0)                                                │
│   • coverage: every extracted question appears exactly once;       │
│     un-graded ones surface as 0 with an "unclear" note             │
│   • obtainedMarks = Σ awarded (NEVER read from the model)          │
│   • totalMarks = declared value || Σ maxMarks                      │
│   • percentage + grade letter computed from fixed bands            │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Why each change lifts accuracy

- **Canonical question list first** — grading calls reference `Q#`, so a model can
  no longer merge or skip questions; the harness *tells* it what exists.
- **Answer mapping in extraction** — the "which answer belongs to which question"
  problem is solved once, in the phase whose only job is reading the material.
- **Image routing** — each grading call receives only the images its questions
  live on (falling back to all images when the mapping is uncertain), so the model
  does not re-orient across irrelevant pages.
- **Small outputs** — a batch of 4 questions produces a small JSON that fits well
  inside output limits: no truncation, no retry storms.
- **Median + dispute-only adjudication** — reviewer noise is cancelled without
  paying an LLM call for agreement; the adjudicator's context is spent only where
  reviewers genuinely disagree.
- **Deterministic totals** — the reported 16/20-vs-13/20 class of bug becomes
  impossible: the header number is computed from the same array the breakdown
  renders.

### 2.3 Harness configuration (src/config/examiner.config.ts)

```ts
export const HARNESS = {
  gradeBatchSize: 4,        // single-mode questions per grading call
  agentReviewBatchSize: 8,  // questions per reviewer call
  adjudicateBatchSize: 10,  // disputed questions per adjudication call
  disputeTolerance: 0.15,   // reviewer spread tolerated before adjudication
  staggerMs: 250,           // stagger between parallel calls (rate-limit mercy)
}
```

---

## 3. Token accounting (new)

Users asked for a **total token count with a breakdown — no cost math.**

- Every provider call now returns real usage when available:
  - Gemini: `usageMetadata` (prompt / candidates / total).
  - OpenAI-compatible: `usage` (prompt / completion / total).
  - The Cloudflare proxy (`/api/ai`) forwards upstream usage in the response body
    (extended `ProxyOk`), so shared-tier calls are counted exactly too.
- When a provider omits usage, a clearly-marked **estimate** is used
  (text ≈ chars/4 + ≈800 tokens/image) and displayed with a "≈" marker.
- A `TokenLedger` records every call: phase, model, prompt tokens, completion
  tokens, estimated flag.
- Surfaced in three places:
  1. **Live during examination** — an animated counter in the pipeline overlay.
  2. **In the report** — a Token Usage card: total, by-phase table, by-model
     table, call count.
  3. **Persisted** with the exam record, so reopening a report shows the same
     numbers.

---

## 4. Defaults & key policy

- **Agent mode is the default mode** for new users.
- When the server offers "Provided for you" (admin) models and the user has not
  made any explicit choice, up to 3 admin models are **auto-selected** (spread
  across providers when possible).
- The moment the user either (a) adds their own provider key, or (b) manually
  changes the model selection / mode, the auto-selection stops overriding them —
  their choice is remembered via a `selectionChosen` flag.
- If the user adds their own key while still on auto-selection, the default
  switches to *their* models.

---

## 5. Interface & animation upgrades

### 5.1 Examination overlay (v2)

- New stage list matching the real pipeline: *Prepare → Extract → Grade / Review →
  Adjudicate → Coach → Finish*.
- **Live per-question chips**: as each grading batch lands, its questions appear
  as verdict-colored chips (`Q১(ক) 2/2 ✓`), so the committee's progress is visible.
- **Live token meter** (animated count-up) and an elapsed-time clock.
- Reviewer panel shows each model working with its role.

### 5.2 Report (v2)

- **Verdict filter chips** (All / Correct / Partial / Incorrect / Unanswered /
  Unclear) with counts and animated list filtering.
- **Expand-all / collapse-all** for the question breakdown.
- Question bodies now show *Mistakes* and *What was correct* alongside evidence.
- **Token usage card** (see §3).
- **Export tools**: download the report as JSON, print-friendly view, copy a
  plain-text summary.
- Celebration confetti burst for scores ≥ 80% (respecting `prefers-reduced-motion`).
- Committee card (agent mode): each reviewer's proposed total — now computed from
  that reviewer's own per-question marks, so it is internally consistent.

### 5.3 Home page

- Mode selection (Single vs Agent) moved onto the launch card with animated
  toggle, so the default mode is visible and changeable in one click.
- A notice when models were auto-selected for the user ("Free examiners selected
  for you — add your own key anytime").

---

## 6. Delivery plan

| # | Work package | Files |
|---|---|---|
| 1 | Roadmap (this document) | `ROADMAP.md` |
| 2 | New prompts + JSON schemas for extract/grade/review/adjudicate/coach | `src/lib/prompts.ts` |
| 3 | New pipeline engine, batching, reconciliation, deterministic aggregation | `src/lib/pipeline.ts`, `src/lib/harness.ts` (new) |
| 4 | Token ledger + usage plumbing (browser, SDK, proxy) | `src/lib/tokens.ts` (new), `src/lib/providers.ts`, `src/lib/gemini.ts`, `shared/aiWire.ts`, `functions/_lib/upstream.ts`, `functions/_lib/handler.ts` |
| 5 | Numbered image routing in material collection | `src/lib/examRunner.ts` |
| 6 | Defaults & auto-selection | `src/lib/settings.ts`, `src/lib/serverModels.tsx`, `src/components/SettingsModal.tsx` |
| 7 | Overlay v2, Report v2, Home v2 | `src/components/PipelineOverlay.tsx`, `src/components/report/ReportView.tsx`, `src/pages/HomePage.tsx`, `src/styles.css` |
| 8 | Five-language copy for all new strings | `src/i18n/*.ts` |
| 9 | Docs refresh | `README.md`, `src/pages/InfoPages.tsx` |

## 7. Acceptance checklist

- [ ] Single mode produces a per-question result for every extracted question.
- [ ] Report header score always equals the sum of the question breakdown.
- [ ] No question is ever awarded more than its maximum marks.
- [ ] Reviewer "proposed totals" equal the sum of that reviewer's own findings.
- [ ] Token total is shown live and in the report, with per-phase/per-model
      breakdown, and "≈" when estimated.
- [ ] Fresh browser → Agent mode + free models pre-selected; user choice sticks
      after any manual change.
- [ ] `npm run build` passes with zero TypeScript errors.
- [ ] Old saved reports (v0.2 shape) still render.

## 8. Future work (out of scope for v0.3.0)

- Optional OCR pre-pass for fully-illegible scripts.
- Per-question marking-scheme hints supplied by the teacher.
- Streaming grading (SSE) instead of batch polling.
- localized grade-band presets per country.
