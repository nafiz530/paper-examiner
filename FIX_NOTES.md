# Gemini SDK fix — what changed (v0.2.1 → v0.2.2)

## Root causes of the Gemini failures
1. **Dead model IDs** — admin config shipped `gemini-2.0-flash`, shut down by Google on 2026-06-01 → 404 BAD_MODEL.
2. **Deprecated sampling params** — `temperature` was sent on every Gemini call; Gemini 3.x models reject `temperature`/`topP`/`topK` → 400.
3. **Silent failure modes** — safety blocks (`promptFeedback.blockReason`) and truncation (`finishReason: MAX_TOKENS`) returned empty bodies, reported as useless UNREADABLE errors.
4. **Hand-rolled REST calls** — fragile against API surface changes.

## Changes
| File | Change |
|---|---|
| `package.json` | added dependency `@google/genai: ^1.30.0` (official Google GenAI SDK) |
| `src/lib/gemini.ts` | **NEW** — SDK client factory (per call, key-pool safe), `geminiJsonConfig()` (JSON schema, no temperature on 3.x, relaxed safety `BLOCK_ONLY_HIGH`, timeout), `readGeminiResponse()` (blockReason / finishReason handling), `toGeminiAIError()` (maps SDK errors onto the AIError taxonomy) |
| `src/lib/providers.ts` | `callGemini()` rewritten on the SDK; old REST code + `GEMINI_BASE` removed |
| `src/ai.ts` | `testAIConnection()` gemini branch rewritten on the SDK |
| `src/config/examiner.config.ts` | default models → `gemini-3.8-flash`, `gemini-3.5-flash-lite` |

Unchanged: key pool rotation/cooldown, retry matrix, i18n error keys, OpenAI-compatible providers, all UI code.

## Notes
- This is a client-side SPA: no `dotenv`/`process.env` — keys come from the existing key pool per call, so the Gemini client is built per call with the rotated key.
- In the JS SDK, thinking is configured via `thinkingConfig: { thinkingBudget }`, not `generationConfig.thinking_level`.
- **You must run `npm install && npm run build`** — the checked-in `dist/` is stale and does not contain these fixes.
- If a user still has an old model ID saved in their browser settings (localStorage), they should re-pick a model in Settings.
