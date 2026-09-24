/**
 * Token accounting for the examiner harness.
 *
 * Every AI call is recorded with its real usage when the provider reports it
 * (Gemini usageMetadata / OpenAI-compatible usage / proxy-forwarded usage).
 * When a provider omits usage we record a clearly-marked ESTIMATE
 * (text ≈ chars/4 + ≈800 tokens per image) — displayed with "≈" in the UI.
 *
 * No cost math anywhere, by explicit product decision.
 */

import type { ModelRef } from './settings'

export type Usage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated: boolean
}

export type TokenPhase = 'extract' | 'grade' | 'review' | 'adjudicate' | 'coach' | 'test'

export type TokenRecord = {
  phase: TokenPhase
  /** phase detail, e.g. reviewer role or batch label */
  detail?: string
  model: string
  providerLabel: string
  at: number
  usage: Usage
}

export type PhaseTotal = { phase: TokenPhase; promptTokens: number; completionTokens: number; totalTokens: number; calls: number; estimated: boolean }
export type ModelTotal = { model: string; providerLabel: string; promptTokens: number; completionTokens: number; totalTokens: number; calls: number; estimated: boolean }

export type UsageSummary = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
  /** true when ANY record is estimated */
  estimated: boolean
  byPhase: PhaseTotal[]
  byModel: ModelTotal[]
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimated: a.estimated || b.estimated,
  }
}

/** Rough fallback when a provider does not report usage. */
export function estimateUsage(system: string, user: string, imageCount: number, outputText: string): Usage {
  const inputChars = system.length + user.length
  const promptTokens = Math.ceil(inputChars / 4) + imageCount * 800
  const completionTokens = Math.ceil(outputText.length / 4)
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated: true }
}

/** Normalize a provider usage object of unknown shape into a Usage. Returns null when absent/invalid. */
export function usageFromRaw(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  // OpenAI-compatible: { prompt_tokens, completion_tokens, total_tokens }
  // Gemini: { promptTokenCount, candidatesTokenCount, totalTokenCount }
  // Proxy (normalized): { promptTokens, completionTokens, totalTokens }
  const prompt = num(r.promptTokens) ?? num(r.prompt_tokens) ?? num(r.promptTokenCount)
  const completion = num(r.completionTokens) ?? num(r.completion_tokens) ?? num(r.candidatesTokenCount)
  const total = num(r.totalTokens) ?? num(r.total_tokens) ?? num(r.totalTokenCount)
  if (prompt === undefined && completion === undefined && total === undefined) return null
  const p = prompt ?? Math.max(0, (total ?? 0) - (completion ?? 0))
  const c = completion ?? Math.max(0, (total ?? 0) - p)
  return { promptTokens: p, completionTokens: c, totalTokens: total ?? p + c, estimated: false }
}

/* --------------------------------- Ledger --------------------------------- */

export class TokenLedger {
  private records: TokenRecord[] = []

  add(phase: TokenPhase, model: ModelRef | string, providerLabel: string, usage: Usage, detail?: string) {
    const m = typeof model === 'string' ? model : model.model
    this.records.push({ phase, detail, model: m, providerLabel, at: Date.now(), usage })
  }

  get list(): readonly TokenRecord[] { return this.records }

  live(): Usage & { calls: number } {
    let u = emptyUsage()
    for (const r of this.records) u = addUsage(u, r.usage)
    return { ...u, calls: this.records.length }
  }

  summarize(): UsageSummary {
    const byPhase = new Map<TokenPhase, PhaseTotal>()
    const byModel = new Map<string, ModelTotal>()
    let totals = emptyUsage()
    let estimated = false
    for (const r of this.records) {
      totals = addUsage(totals, r.usage)
      estimated = estimated || r.usage.estimated
      const p = byPhase.get(r.phase) ?? { phase: r.phase, promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, estimated: false }
      p.promptTokens += r.usage.promptTokens; p.completionTokens += r.usage.completionTokens; p.totalTokens += r.usage.totalTokens; p.calls += 1
      p.estimated = p.estimated || r.usage.estimated
      byPhase.set(r.phase, p)
      const m = byModel.get(r.model) ?? { model: r.model, providerLabel: r.providerLabel, promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, estimated: false }
      m.promptTokens += r.usage.promptTokens; m.completionTokens += r.usage.completionTokens; m.totalTokens += r.usage.totalTokens; m.calls += 1
      m.estimated = m.estimated || r.usage.estimated
      byModel.set(r.model, m)
    }
    const phaseOrder: TokenPhase[] = ['extract', 'grade', 'review', 'adjudicate', 'coach', 'test']
    return {
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.totalTokens,
      calls: this.records.length,
      estimated,
      byPhase: [...byPhase.values()].sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase)),
      byModel: [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    }
  }
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(Math.round(n))
}
