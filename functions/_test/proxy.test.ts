/* Run with: npx tsx functions/_test/proxy.test.ts  — no test framework needed. */
import { handleAI, handleModels } from '../_lib/handler'
import { _resetRateLimitMemory } from '../_lib/ratelimit'
import { parseKeys } from '../_lib/keys'
import { redact } from '../_lib/upstream'
import type { ServerProvider, Env } from '../_lib/config'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  ' + extra}`) }

const ORIGIN = 'https://paper-examiner.pages.dev'
const KEY_A = 'AIzaSyA_FAKE_KEY_AAAAAAAAAAAAAAAAAAAAAAA'
const KEY_B = 'AIzaSyB_FAKE_KEY_BBBBBBBBBBBBBBBBBBBBBBB'
const providers: ServerProvider[] = [
  { id: 'gemini-free', type: 'gemini', label: 'Gemini', keysEnv: 'GEMINI_KEYS', models: ['gemini-3.8-flash'], enabled: true },
  { id: 'openai-free', type: 'openai', label: 'OpenAI', keysEnv: 'OPENAI_KEYS', models: ['gpt-4o-mini'], enabled: true },
  { id: 'off', type: 'gemini', label: 'Off', keysEnv: 'GEMINI_KEYS', models: ['gemini-3.8-flash'], enabled: false },
]
const baseEnv = (): Env => ({ GEMINI_KEYS: `${KEY_A}\n${KEY_B}`, OPENAI_KEYS: 'sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE' })

const goodBody = (over: Record<string, unknown> = {}) => ({
  providerId: 'gemini-free', model: 'gemini-3.8-flash', system: 'sys', user: 'hello',
  images: [], schemaName: 'x', schema: { type: 'object' }, maxTokens: 500, ...over,
})
const post = (body: unknown, headers: Record<string, string> = {}, url = ORIGIN + '/api/ai') =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

const geminiOK = (text = '{"a":1}') => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }), { status: 200 })
type Call = { url: string; headers: Record<string, string>; body: any }
const mkFetch = (handler: (c: Call, n: number) => Response | Promise<Response>) => {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers as HeadersInit).forEach((v, k) => { headers[k] = v })
    const call = { url: String(url), headers, body: init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body }
    calls.push(call)
    return handler(call, calls.length)
  }) as unknown as typeof fetch
  return { f, calls }
}

const run = async () => {
  console.log('\n[origin / method / content-type]')
  { _resetRateLimitMemory()
    const { f } = mkFetch(() => geminiOK())
    let r = await handleAI(post(goodBody(), { Origin: 'https://evil.example' }), baseEnv(), { fetchImpl: f, providers })
    ok('foreign Origin → 403 FORBIDDEN_ORIGIN', r.status === 403 && (await r.json()).code === 'FORBIDDEN_ORIGIN')
    const noOrigin = new Request(ORIGIN + '/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goodBody()) })
    r = await handleAI(noOrigin, baseEnv(), { fetchImpl: f, providers })
    ok('missing Origin (curl) → 403', r.status === 403)
    r = await handleAI(post(goodBody(), { 'Content-Type': 'text/plain' }), baseEnv(), { fetchImpl: f, providers })
    ok('non-JSON content-type → 415', r.status === 415)
    r = await handleAI(post(goodBody(), { Origin: 'https://exam.example.com' }), { ...baseEnv(), ALLOWED_ORIGINS: 'https://exam.example.com' }, { fetchImpl: f, providers })
    ok('Origin in ALLOWED_ORIGINS → allowed', r.status === 200)
  }

  console.log('\n[allowlist: provider / model / disabled]')
  { _resetRateLimitMemory()
    const { f, calls } = mkFetch(() => geminiOK())
    let r = await handleAI(post(goodBody({ model: 'gemini-2.5-pro' })), baseEnv(), { fetchImpl: f, providers })
    ok('model not in allowlist → 400 BAD_MODEL, upstream NOT called', r.status === 400 && (await r.json()).code === 'BAD_MODEL' && calls.length === 0)
    r = await handleAI(post(goodBody({ providerId: 'nope' })), baseEnv(), { fetchImpl: f, providers })
    ok('unknown provider → BAD_MODEL', (await r.json()).code === 'BAD_MODEL')
    r = await handleAI(post(goodBody({ providerId: 'off' })), baseEnv(), { fetchImpl: f, providers })
    ok('disabled provider → BAD_MODEL', (await r.json()).code === 'BAD_MODEL')
    r = await handleAI(post(goodBody({ baseURL: 'https://evil.example/v1', url: 'https://evil.example' })), baseEnv(), { fetchImpl: f, providers })
    ok('client-supplied baseURL/url is ignored (request goes to google only)', r.status === 200 && calls.every((c) => c.url.startsWith('https://generativelanguage.googleapis.com/')))
  }

  console.log('\n[secrets: header not URL, never echoed]')
  { _resetRateLimitMemory()
    const { f, calls } = mkFetch(() => geminiOK())
    const r = await handleAI(post(goodBody()), baseEnv(), { fetchImpl: f, providers })
    const txt = await r.text()
    ok('success → 200 {ok,text}', r.status === 200 && JSON.parse(txt).text === '{"a":1}')
    ok('key sent in x-goog-api-key header', [KEY_A, KEY_B].includes(calls[0].headers['x-goog-api-key']))
    ok('key NOT present in upstream URL', !calls[0].url.includes('AIza') && !calls[0].url.includes('key='))
    ok('key NOT in response body', !txt.includes('AIza'))
    ok('response is no-store', r.headers.get('Cache-Control') === 'no-store')
    ok('no CORS header emitted', r.headers.get('Access-Control-Allow-Origin') === null)
    ok('gemini 3.x request has NO temperature', calls[0].body.generationConfig.temperature === undefined)
  }

  console.log('\n[key rotation + safe errors]')
  { _resetRateLimitMemory()
    // key A rejected (403 leaked), key B works → must succeed via rotation
    const { f, calls } = mkFetch((c) => c.headers['x-goog-api-key'] === KEY_A
      ? new Response(JSON.stringify({ error: { code: 403, message: `Your API key ${KEY_A} was reported as leaked.` } }), { status: 403 })
      : geminiOK())
    let succeeded = 0
    for (let i = 0; i < 12; i++) { _resetRateLimitMemory(); const r = await handleAI(post(goodBody()), baseEnv(), { fetchImpl: f, providers }); if (r.status === 200) succeeded++ }
    ok('leaked/403 key is skipped → always succeeds via the good key (12/12)', succeeded === 12, `got ${succeeded}/12, ${calls.length} upstream calls`)
  }
  { _resetRateLimitMemory()
    const { f } = mkFetch(() => new Response(JSON.stringify({ error: { message: `bad key ${KEY_A}` } }), { status: 403 }))
    const r = await handleAI(post(goodBody()), baseEnv(), { fetchImpl: f, providers })
    const txt = await r.text()
    ok('ALL keys dead → 503 UPSTREAM_AUTH', r.status === 503 && JSON.parse(txt).code === 'UPSTREAM_AUTH')
    ok('…and the response leaks neither key nor provider text', !txt.includes('AIza') && !/reported as leaked|bad key/.test(txt))
  }
  { _resetRateLimitMemory()
    const { f } = mkFetch(() => new Response('{}', { status: 429 }))
    const r = await handleAI(post(goodBody()), baseEnv(), { fetchImpl: f, providers })
    ok('all keys 429 → 429 UPSTREAM_QUOTA + Retry-After', r.status === 429 && r.headers.get('Retry-After') === '30')
  }
  { _resetRateLimitMemory()
    const { f, calls } = mkFetch(() => new Response(JSON.stringify({ error: { message: 'invalid schema' } }), { status: 400 }))
    const r = await handleAI(post(goodBody({ providerId: 'gemini-free' })), baseEnv(), { fetchImpl: f, providers })
    ok('upstream 400 is NOT rotated (same body would fail on every key)', r.status === 400 && calls.length === 1)
  }

  console.log('\n[size + shape limits]')
  { _resetRateLimitMemory()
    const { f, calls } = mkFetch(() => geminiOK())
    const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64')
    let r = await handleAI(post(goodBody({ images: Array.from({ length: 13 }, () => ({ mimeType: 'image/jpeg', data: 'AAAA' })) })), baseEnv(), { fetchImpl: f, providers })
    ok('13 images → 413', r.status === 413)
    r = await handleAI(post(goodBody({ images: [{ mimeType: 'image/jpeg', data: b64(5 * 1024 * 1024) }] })), baseEnv(), { fetchImpl: f, providers })
    ok('5 MB image → 413', r.status === 413)
    r = await handleAI(post(goodBody({ images: [{ mimeType: 'image/svg+xml', data: 'AAAA' }] })), baseEnv(), { fetchImpl: f, providers })
    ok('svg mime rejected (only jpeg/png/webp/gif)', r.status === 400)
    r = await handleAI(post(goodBody({ images: [{ mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }] })), baseEnv(), { fetchImpl: f, providers })
    ok('data: URL prefix rejected', r.status === 400)
    r = await handleAI(post(goodBody({ images: [{ mimeType: 'image/png', data: 'not base64!!' }] })), baseEnv(), { fetchImpl: f, providers })
    ok('non-base64 rejected', r.status === 400)
    r = await handleAI(post(goodBody({ maxTokens: 9_000_000 })), baseEnv(), { fetchImpl: f, providers })
    ok('maxTokens is CLAMPED (not rejected) to 8192', r.status === 200 && calls.at(-1)!.body.generationConfig.maxOutputTokens === 8192)
    r = await handleAI(post(goodBody({ user: 'x'.repeat(500_000) })), baseEnv(), { fetchImpl: f, providers })
    ok('500k-char prompt → 413', r.status === 413)
    r = await handleAI(post('{not json'), baseEnv(), { fetchImpl: f, providers })
    ok('malformed JSON → 400', r.status === 400)
    r = await handleAI(post(goodBody({ schemaName: 'bad name!' })), baseEnv(), { fetchImpl: f, providers })
    ok('bad schemaName → 400', r.status === 400)
    const huge = new Request(ORIGIN + '/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '9.9.9.9' }, body: 'x'.repeat(13 * 1024 * 1024) })
    r = await handleAI(huge, baseEnv(), { fetchImpl: f, providers })
    ok('13 MB body (no Content-Length) aborted by streaming cap → 413', r.status === 413)
  }

  console.log('\n[rate limiting]')
  { _resetRateLimitMemory()
    const { f } = mkFetch(() => geminiOK())
    let last = 200, n = 0
    for (let i = 0; i < 45; i++) { const r = await handleAI(post(goodBody(), { 'CF-Connecting-IP': '5.5.5.5' }), baseEnv(), { fetchImpl: f, providers }); last = r.status; if (r.status === 200) n++ }
    ok('41st call from one IP is throttled (40 allowed)', n === 40 && last === 429, `allowed=${n} last=${last}`)
    const other = await handleAI(post(goodBody(), { 'CF-Connecting-IP': '6.6.6.6' }), baseEnv(), { fetchImpl: f, providers })
    ok('a different IP is unaffected', other.status === 200)
    const throttled = await handleAI(post(goodBody(), { 'CF-Connecting-IP': '5.5.5.5' }), baseEnv(), { fetchImpl: f, providers })
    ok('429 carries Retry-After', Number(throttled.headers.get('Retry-After')) > 0)
  }

  console.log('\n[turnstile]')
  { _resetRateLimitMemory()
    const keysOnly = { ...baseEnv(), TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET: 'secret' }
    { const { f: f0 } = mkFetch(() => geminiOK()); const r0 = await handleAI(post(goodBody()), keysOnly, { fetchImpl: f0, providers })
      ok('keys set but TURNSTILE_ENFORCE unset → NOT enforced (cannot brick the site)', r0.status === 200)
      const m0 = await handleModels(new Request(ORIGIN + '/api/models'), keysOnly, providers).json() as any
      ok('…and /api/models does not advertise a site key that would mislead the SPA', m0.turnstileSiteKey === undefined) }
    const env = { ...keysOnly, TURNSTILE_ENFORCE: '1' }
    const { f, calls } = mkFetch((c) => c.url.includes('turnstile') ? new Response(JSON.stringify({ success: c.body.toString().includes('response=good') }), { status: 200 }) : geminiOK())
    let r = await handleAI(post(goodBody()), env, { fetchImpl: f, providers })
    ok('Turnstile on + no token → 403 (fails closed), upstream AI not called', r.status === 403 && !calls.some((c) => c.url.includes('googleapis')))
    r = await handleAI(post(goodBody({ turnstileToken: 'bad' })), env, { fetchImpl: f, providers })
    ok('bad token → 403', r.status === 403)
    r = await handleAI(post(goodBody({ turnstileToken: 'good' })), env, { fetchImpl: f, providers })
    ok('good token → 200', r.status === 200)
  }

  console.log('\n[openai-compatible adapter]')
  { _resetRateLimitMemory()
    const { f, calls } = mkFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }))
    const r = await handleAI(post(goodBody({ providerId: 'openai-free', model: 'gpt-4o-mini', images: [{ mimeType: 'image/png', data: 'AAAA' }] })), baseEnv(), { fetchImpl: f, providers })
    ok('routes to api.openai.com with Bearer from env', r.status === 200 && calls[0].url === 'https://api.openai.com/v1/chat/completions' && calls[0].headers['authorization'].startsWith('Bearer sk-proj-'))
    ok('image sent as data URL to provider', JSON.stringify(calls[0].body.messages[1].content).includes('data:image/png;base64,AAAA'))
  }
  { _resetRateLimitMemory()
    let n = 0
    const { f, calls } = mkFetch(() => (++n === 1 ? new Response('{"error":{"message":"response_format json_schema unsupported"}}', { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: 'fine' } }] }), { status: 200 })))
    const r = await handleAI(post(goodBody({ providerId: 'openai-free', model: 'gpt-4o-mini' })), baseEnv(), { fetchImpl: f, providers })
    ok('json_schema 400 falls back to json_object', r.status === 200 && calls.length === 2 && calls[1].body.response_format.type === 'json_object')
  }

  console.log('\n[/api/models never exposes secrets]')
  {
    const r = handleModels(new Request(ORIGIN + '/api/models'), baseEnv(), providers)
    const txt = await r.text(); const j = JSON.parse(txt)
    ok('lists only configured+enabled providers', j.providers.map((p: any) => p.id).sort().join() === 'gemini-free,openai-free')
    ok('no key material / env names in output', !/AIza|sk-proj|KEYS|keysEnv/.test(txt))
    const none = JSON.parse(await handleModels(new Request(ORIGIN + '/api/models'), {}, providers).text())
    ok('provider with no key in env is hidden', none.providers.length === 0)
  }

  console.log('\n[helpers]')
  ok('parseKeys splits comma/newline, drops placeholders & short junk', parseKeys(`PASTE_YOUR_KEY_HERE_xxxxxxxx, ${KEY_A}\n\n short ;${KEY_B}`).length === 2)
  ok('redact strips known key + AIza + sk- + Bearer', !/AIza|sk-abc|Bearer abc/.test(redact(`k=${KEY_A} sk-abcdefghijklmnopqrstuv Bearer abcdefghijklmnopqrstuv`, [KEY_A])))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(2) })
