export type AIProvider = 'gemini' | 'openai' | 'mistral' | 'openrouter' | 'groq'

export type AIConfig = {
  provider: AIProvider
  apiKey: string
  model: string
}

export const PROVIDERS: Record<AIProvider, { label: string; placeholder: string; endpoint: string }> = {
  gemini: { label: 'Google Gemini', placeholder: 'gemini-…', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models' },
  openai: { label: 'OpenAI', placeholder: 'gpt-…', endpoint: 'https://api.openai.com/v1/chat/completions' },
  mistral: { label: 'Mistral', placeholder: 'mistral-…', endpoint: 'https://api.mistral.ai/v1/chat/completions' },
  openrouter: { label: 'OpenRouter', placeholder: 'provider/model', endpoint: 'https://openrouter.ai/api/v1/chat/completions' },
  groq: { label: 'Groq', placeholder: 'model-name', endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
}

const STORAGE_KEY = 'paper-examiner-ai-config'

export function loadAIConfig(): AIConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '')
    if (parsed && typeof parsed === 'object') return { provider: parsed.provider, apiKey: parsed.apiKey || '', model: parsed.model || '' }
  } catch {}
  return { provider: 'gemini', apiKey: '', model: '' }
}

export function saveAIConfig(config: AIConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function clearAIConfig() {
  localStorage.removeItem(STORAGE_KEY)
}

async function parseError(response: Response) {
  const raw = await response.text()
  try {
    const data = JSON.parse(raw)
    return data?.error?.message || data?.message || raw || 'Request failed (' + response.status + ')'
  } catch {
    return raw || 'Request failed (' + response.status + ')'
  }
}

export async function testAIConnection(config: AIConfig): Promise<string> {
  if (!config.apiKey.trim()) throw new Error('Enter an API key first.')
  if (!config.model.trim()) throw new Error('Enter the exact full model ID first.')

  if (config.provider === 'gemini') {
    const url = PROVIDERS.gemini.endpoint + '/' + encodeURIComponent(config.model.trim()) + ':generateContent?key=' + encodeURIComponent(config.apiKey.trim())
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: CONNECTION_OK' }] }], generationConfig: { maxOutputTokens: 8 } }),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return 'Connection verified.'
  }

  const response = await fetch(PROVIDERS[config.provider].endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey.trim() },
    body: JSON.stringify({ model: config.model.trim(), messages: [{ role: 'user', content: 'Reply with exactly: CONNECTION_OK' }], max_tokens: 8, temperature: 0 }),
  })
  if (!response.ok) throw new Error(await parseError(response))
  return 'Connection verified.'
}
