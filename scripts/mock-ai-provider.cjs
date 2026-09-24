#!/usr/bin/env node
/**
 * Mock OpenAI-compatible AI provider for END-TO-END testing of the v0.3 harness.
 * (Referenced by vite.config.ts — /mockv1/* is proxied here during `npm run dev`.)
 *
 * It implements every phase of the examiner pipeline with deterministic answers:
 *   extraction → returns an 8-question Bangla-style paper (the exact shape that
 *   used to produce the 16/20-vs-13/20 bug), marking → deterministic per-question
 *   marks, adjudication → settles disputes, coach → coaching JSON.
 *
 * Reviewer roles get slightly different marks on Q১(গ) to force one dispute.
 * Usage is reported in OpenAI format so the token meter/cards can be verified.
 *
 * Run: node scripts/mock-ai-provider.cjs   (listens on :9999)
 */
const http = require('http')

const QUESTIONS = [
  { number: '১(ক)', prompt: 'সরলরেখার সমীকরণ নির্ণয় কর।', marks: 2 },
  { number: '১(খ)', prompt: 'সরলরেখাটি অঙ্কন করে ছেদবিন্দু দেখাও।', marks: 4 },
  { number: '১(গ)', prompt: 'ত্রিভুজের ক্ষেত্রফল নির্ণয় ও সমকোণী ত্রিভুজ প্রমাণ কর।', marks: 4 },
  { number: '১০(ক)', prompt: 'ত্রিভুজের ক্ষেত্রফল নির্ণয় কর।', marks: 2 },
  { number: '১০(খ)', prompt: 'অক্ষের ছেদবিন্দু নির্ণয় কর।', marks: 2 },
  { number: '১০(গ)', prompt: 'রেখাদ্বয়ের মধ্যবর্তী কোণ নির্ণয় কর।', marks: 2 },
  { number: '১০(ঘ)', prompt: 'সরলরেখার ঢাল নির্ণয় কর।', marks: 2 },
  { number: '১০(ঙ)', prompt: 'বিন্দুটি রেখার উপরে কি না যাচাই কর।', marks: 2 },
]

/** Base marks per question (sums to 13/20 — mirrors the user's real example). */
const BASE = {
  '১(ক)': { marks: 2, verdict: 'correct' },
  '১(খ)': { marks: 3, verdict: 'partially_correct' },
  '১(গ)': { marks: 0, verdict: 'incorrect' },
  '১০(ক)': { marks: 2, verdict: 'correct' },
  '১০(খ)': { marks: 2, verdict: 'correct' },
  '১০(গ)': { marks: 2, verdict: 'correct' },
  '১০(ঘ)': { marks: 2, verdict: 'correct' },
  '১০(ঙ)': { marks: 0, verdict: 'unanswered' },
}

const TOPICS = {
  '১(ক)': 'সরলরেখার সমীকরণ',
  '১(খ)': 'সরলরেখা ও জ্যামিতিক চিত্র',
  '১(গ)': 'ত্রিভুজের ক্ষেত্রফল ও প্রমাণ',
  '১০(ক)': 'ত্রিভুজের ক্ষেত্রফল',
  '১০(খ)': 'অক্ষের ছেদবিন্দু',
  '১০(গ)': 'রেখাদ্বয়ের মধ্যবর্তী কোণ',
  '১০(ঘ)': 'সরলরেখার ঢাল',
  '১০(ঙ)': 'বিন্দুর অবস্থান',
}

function extractPhase() {
  return {
    reportLanguage: 'bn',
    paperTitle: 'গণিত মক টেস্ট',
    subject: 'Mathematics',
    questions: QUESTIONS.map((q) => ({
      number: q.number,
      prompt: q.prompt,
      marks: q.marks,
      marksConfident: true,
      questionImageIdxs: [],
      answerText: `শিক্ষার্থীর ${q.number} নম্বর প্রশ্নের লেখা উত্তর (মক)।`,
      answerImageIdxs: [],
      answerLegibility: 'clear',
    })),
    totalMarksDetected: 20,
    notes: ['মক প্রোভাইডার থেকে তৈরি।'],
  }
}

/** OpenAI-compatible content can be a string OR an array of parts — flatten to text. */
function userText(body) {
  const c = body.messages?.[1]?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n')
  return String(c ?? '')
}

function gradePhase(body) {
  const user = userText(body)
  const sys = String(body.messages?.[0]?.content || '')
  const isReviewer = /independent exam reviewer|YOUR REVIEWER ROLE/i.test(sys)
  const roleIdx = /Strict examiner/i.test(sys) ? 0 : /Fair examiner/i.test(sys) ? 1 : 2
  // pull the question numbers this batch was asked to grade
  const numbers = [...user.matchAll(/^NUMBER: (.+)$/gm)].map((m) => m[1].trim())
  const findings = numbers.map((n) => {
    const base = BASE[n] ?? { marks: 0, verdict: 'unclear' }
    const q = QUESTIONS.find((x) => x.number === n)
    let marks = base.marks
    // reviewers disagree on ১(গ): Strict 0, Fair 2, Error hunter 1 → dispute
    if (n === '১(গ)' && isReviewer) marks = [0, 2, 1][roleIdx]
    const verdict = base.verdict === 'unanswered' ? 'unanswered' : marks === 0 ? 'incorrect' : q && marks >= q.marks ? 'correct' : 'partially_correct'
    return {
      number: n,
      verdict,
      awardedMarks: marks,
      answerLocated: base.verdict !== 'unanswered',
      explanation: `মক ব্যাখ্যা: ${n} প্রশ্নে ${marks} নম্বর দেওয়া হয়েছে।`,
      evidence: [`শিক্ষার্থীর উত্তরপত্রে "${n}" অংশে এই কাজ দেখা যায়।`],
      mistakes: q && marks < q.marks ? ['মাঝপথের একটি ধাপ ভুল ছিল।'] : [],
      whatWasCorrect: marks > 0 ? ['প্রাথমিক ধাপগুলো সঠিক ছিল।'] : [],
    }
  })
  return { findings }
}

function adjudicatePhase(body) {
  const user = userText(body)
  const numbers = [...user.matchAll(/^NUMBER: (.+)$/gm)].map((m) => m[1].trim())
  return {
    findings: numbers.map((n) => {
      const base = BASE[n] ?? { marks: 0, verdict: 'incorrect' }
      return {
        number: n,
        verdict: base.verdict,
        awardedMarks: base.marks,
        explanation: `মক রায়: ${n} প্রশ্নে রিভিউয়ারদের প্রমাণ মিলিয়ে ${base.marks} নম্বর নির্ধারিত হলো।`,
        evidence: ['শিক্ষার্থীর উত্তরে সম্পূর্ণ প্রমাণ অনুপস্থিত।'],
        resolutionNote: `রিভিউয়াররা 0/2/1 প্রস্তাব করেছিলেন; প্রমাণ মিলিয়ে ${base.marks} নম্বরে মীমাংসা হলো।`,
      }
    }),
  }
}

function coachPhase() {
  return {
    summary: 'মোট ২০ নম্বরের এই পরীক্ষায় শিক্ষার্থী ১৩ নম্বর পেয়েছে। সরলরেখা অংশে ভালো দক্ষতা আছে; প্রমাণভিত্তিক অংশে দুর্বলতা স্পষ্ট।',
    strengths: ['সরলরেখার সমীকরণ ও ঢাল নির্ণয়ে দক্ষ (Q১(ক), Q১০(ঘ))।'],
    weaknesses: ['জ্যামিতিক প্রমাণ সম্পূর্ণ করতে পারেনি (Q১(গ))।', 'শেষ প্রশ্নের উত্তর দেওয়া হয়নি (Q১০(ঙ))।'],
    suggestions: ['ত্রিভুজের ক্ষেত্রফল ও প্রমাণ অধ্যায়টি আবার অনুশীলন করুন।', 'পরীক্ষার শেষে সব প্রশ্ন পুনরায় যাচাই করার অভ্যাস করুন।'],
    recommendations: ['সপ্তাহে দুটি প্রমাণ-ভিত্তিক সমস্যা সমাধান করুন।', 'সময় ব্যবস্থাপনার জন্য মক পরীক্ষা দিন।'],
    topicMastery: [
      { topic: 'সরলরেখার সমীকরণ', score: 95 },
      { topic: 'জ্যামিতিক চিত্র', score: 75 },
      { topic: 'ত্রিভুজ ও প্রমাণ', score: 25 },
      { topic: 'স্থানাঙ্ক জ্যামিতি', score: 85 },
    ],
    questionTopics: QUESTIONS.map((q) => ({ number: q.number, topic: TOPICS[q.number] })),
    confidence: 88,
  }
}

function phaseOf(body) {
  const sys = String(body.messages?.[0]?.content || '')
  if (/EXTRACTION agent/i.test(sys)) return 'extract'
  if (/ADJUDICATOR/i.test(sys)) return 'adjudicate'
  if (/COACH/i.test(sys)) return 'coach'
  if (/MARKING agent/i.test(sys)) return 'grade'
  return 'other'
}

function route(body) {
  switch (phaseOf(body)) {
    case 'extract': return extractPhase()
    case 'adjudicate': return adjudicatePhase(body)
    case 'coach': return coachPhase()
    case 'grade': return gradePhase(body)
    default: return { ok: true }
  }
}

let n = 0
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw) } catch { /* ignore */ }
    const payload = route(body)
    const text = JSON.stringify(payload)
    n += 1
    const sysLen = String(body.messages?.[0]?.content || '').length
    const userContent = body.messages?.[1]?.content
    const userLen = typeof userContent === 'string' ? userContent.length : Array.isArray(userContent) ? userText(body).length : 400
    const promptTokens = Math.ceil((sysLen + userLen) / 4)
    const completionTokens = Math.ceil(text.length / 4)
    const out = {
      id: `mock-${n}`,
      object: 'chat.completion',
      model: body.model || 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
    console.log(`[mock-ai] #${n} ${body.model || '?'} → phase:${phaseOf(body)}`)
  })
})

server.listen(9999, () => console.log('[mock-ai] listening on http://localhost:9999 (OpenAI-compatible)'))
