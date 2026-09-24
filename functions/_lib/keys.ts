import type { Env, ServerProvider } from './config'

/** Parse a secret that may hold several keys separated by commas, semicolons or newlines. */
export function parseKeys(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length >= 16 && !/PASTE_|YOUR_.*KEY|xxxx/i.test(k))
}

export function keysFor(provider: ServerProvider, env: Env): string[] {
  return parseKeys(env[provider.keysEnv])
}

/** A provider is only offered to users if its secret actually holds at least one usable key. */
export function providerConfigured(provider: ServerProvider, env: Env): boolean {
  return provider.enabled && keysFor(provider, env).length > 0
}

/** Random rotation of the pool so load spreads and a bad key doesn't always come first. */
export function shuffled<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
