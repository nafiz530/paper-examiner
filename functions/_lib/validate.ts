import type { ProxyRequest, WireImage } from '../../shared/aiWire'
import { ALLOWED_IMAGE_MIME, LIMITS, SERVER_PROVIDERS, type ServerProvider } from './config'

export class ValidationError extends Error {
  code: 'BAD_REQUEST' | 'BAD_MODEL' | 'PAYLOAD_TOO_LARGE'
  status: number
  constructor(code: ValidationError['code'], message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Approximate decoded byte size of a base64 string without decoding it. */
export function base64DecodedSize(b64: string): number {
  const len = b64.length
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - pad
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * Validate an untrusted JSON body into a ProxyRequest and resolve the server-side provider.
 * Everything the browser controls is checked here; nothing is passed through blindly.
 */
export function validateProxyRequest(
  body: unknown,
  providers: ServerProvider[] = SERVER_PROVIDERS,
): { req: ProxyRequest; provider: ServerProvider } {
  if (!isObj(body)) throw new ValidationError('BAD_REQUEST', 'Body must be a JSON object.')

  const { providerId, model, system, user, images, schemaName, schema, maxTokens, turnstileToken } = body

  if (typeof providerId !== 'string' || !providerId) throw new ValidationError('BAD_REQUEST', 'providerId is required.')
  if (typeof model !== 'string' || !model) throw new ValidationError('BAD_REQUEST', 'model is required.')

  const provider = providers.find((p) => p.id === providerId && p.enabled)
  if (!provider) throw new ValidationError('BAD_MODEL', 'Unknown or disabled provider.')
  if (!provider.models.includes(model)) throw new ValidationError('BAD_MODEL', 'Model is not allowed for this provider.')

  if (typeof system !== 'string' || typeof user !== 'string') throw new ValidationError('BAD_REQUEST', 'system and user must be strings.')
  if (system.length + user.length > LIMITS.maxTextChars) throw new ValidationError('PAYLOAD_TOO_LARGE', 'Prompt is too large.', 413)

  if (typeof schemaName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(schemaName)) {
    throw new ValidationError('BAD_REQUEST', 'schemaName must match [A-Za-z0-9_-]{1,64}.')
  }
  if (!isObj(schema)) throw new ValidationError('BAD_REQUEST', 'schema must be an object.')
  if (JSON.stringify(schema).length > 60_000) throw new ValidationError('PAYLOAD_TOO_LARGE', 'schema is too large.', 413)

  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens < 1) {
    throw new ValidationError('BAD_REQUEST', 'maxTokens must be a positive number.')
  }

  const imgs: WireImage[] = []
  if (images !== undefined) {
    if (!Array.isArray(images)) throw new ValidationError('BAD_REQUEST', 'images must be an array.')
    if (images.length > LIMITS.maxImages) throw new ValidationError('PAYLOAD_TOO_LARGE', `At most ${LIMITS.maxImages} images per request.`, 413)
    for (const img of images) {
      if (!isObj(img) || typeof img.mimeType !== 'string' || typeof img.data !== 'string') {
        throw new ValidationError('BAD_REQUEST', 'Each image needs mimeType and base64 data.')
      }
      if (!ALLOWED_IMAGE_MIME.has(img.mimeType)) throw new ValidationError('BAD_REQUEST', `Unsupported image type: ${img.mimeType}`)
      if (img.data.startsWith('data:')) throw new ValidationError('BAD_REQUEST', 'Image data must be raw base64 without a data: prefix.')
      if (!BASE64_RE.test(img.data)) throw new ValidationError('BAD_REQUEST', 'Image data is not valid base64.')
      if (base64DecodedSize(img.data) > LIMITS.maxImageBytes) throw new ValidationError('PAYLOAD_TOO_LARGE', 'An image exceeds the size limit.', 413)
      imgs.push({ mimeType: img.mimeType, data: img.data })
    }
  }

  return {
    provider,
    req: {
      providerId,
      model,
      system,
      user,
      images: imgs,
      schemaName,
      schema,
      maxTokens: Math.min(Math.floor(maxTokens), LIMITS.maxTokens),
      turnstileToken: typeof turnstileToken === 'string' ? turnstileToken : undefined,
    },
  }
}
