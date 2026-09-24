/** Unified AI error taxonomy — every failure gets a code, a retry policy and a user-facing i18n key. */

export type AIErrorCode =
  | 'NO_KEY'
  | 'PLACEHOLDER_KEY'
  | 'BAD_REQUEST'
  | 'BAD_MODEL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'GEO_BLOCKED'
  | 'RATE_LIMITED'
  | 'QUOTA'
  | 'SERVER'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_JSON'
  | 'UNREADABLE'
  | 'UNKNOWN'

export type ErrorI18nKey =
  | 'errors.noKey'
  | 'errors.placeholderKey'
  | 'errors.badRequest'
  | 'errors.badModel'
  | 'errors.unauthorized'
  | 'errors.forbidden'
  | 'errors.geoBlocked'
  | 'errors.rateLimited'
  | 'errors.quota'
  | 'errors.server'
  | 'errors.timeout'
  | 'errors.network'
  | 'errors.networkOffline'
  | 'errors.networkFile'
  | 'errors.badJson'
  | 'errors.unreadable'
  | 'errors.unknown'
  | 'errors.noModels'

export class AIError extends Error {
  code: AIErrorCode
  status?: number
  /** i18n key for the message shown to the user */
  i18nKey: ErrorI18nKey
  /** whether the pipeline may automatically retry this failure */
  retryable: boolean
  /** provider detail (safe to show, comes from the provider's own error body) */
  detail?: string

  constructor(code: AIErrorCode, i18nKey: ErrorI18nKey, opts: { status?: number; detail?: string; retryable?: boolean } = {}) {
    super(code)
    this.name = 'AIError'
    this.code = code
    this.i18nKey = i18nKey
    this.status = opts.status
    this.detail = opts.detail
    this.retryable = opts.retryable ?? defaultRetryable(code)
  }
}

function defaultRetryable(code: AIErrorCode): boolean {
  switch (code) {
    case 'RATE_LIMITED':
    case 'QUOTA':
    case 'SERVER':
    case 'TIMEOUT':
    case 'NETWORK':
    case 'BAD_JSON':
      return true
    default:
      return false
  }
}

/** Classify an HTTP status from any provider into the unified taxonomy. */
export function classifyStatus(status: number, providerDetail?: string): AIError {
  const detail = providerDetail || undefined
  switch (status) {
    case 400:
      // Gemini returns 400 FAILED_PRECONDITION when the caller's region is not supported.
      if (detail && /location is not supported|failed_precondition/i.test(detail)) {
        return new AIError('GEO_BLOCKED', 'errors.geoBlocked', { status, detail })
      }
      return new AIError('BAD_REQUEST', 'errors.badRequest', { status, detail })
    case 401:
      return new AIError('UNAUTHORIZED', 'errors.unauthorized', { status, detail })
    case 402:
      return new AIError('QUOTA', 'errors.quota', { status, detail })
    case 403:
      return new AIError('FORBIDDEN', 'errors.forbidden', { status, detail })
    case 404:
      return new AIError('BAD_MODEL', 'errors.badModel', { status, detail })
    case 408:
      return new AIError('TIMEOUT', 'errors.timeout', { status, detail, retryable: true })
    case 413:
      return new AIError('BAD_REQUEST', 'errors.badRequest', { status, detail })
    case 429:
      return new AIError('RATE_LIMITED', 'errors.rateLimited', { status, detail, retryable: true })
    case 500:
    case 502:
    case 503:
    case 504:
      return new AIError('SERVER', 'errors.server', { status, detail, retryable: true })
    default:
      return new AIError('UNKNOWN', 'errors.unknown', { status, detail })
  }
}

export function timeoutError(): AIError {
  return new AIError('TIMEOUT', 'errors.timeout', { retryable: true })
}

/** Browser-level request failure. The message pinpoints the most likely cause. */
export function networkError(detail?: string): AIError {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new AIError('NETWORK', 'errors.networkOffline', { detail, retryable: true })
  }
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return new AIError('NETWORK', 'errors.networkFile', { detail, retryable: false })
  }
  return new AIError('NETWORK', 'errors.network', { detail, retryable: true })
}

export function toAIError(e: unknown): AIError {
  if (e instanceof AIError) return e
  if (e instanceof DOMException && e.name === 'AbortError') return timeoutError()
  if (e instanceof TypeError) return networkError(e.message)
  return new AIError('UNKNOWN', 'errors.unknown', { detail: e instanceof Error ? e.message : String(e) })
}
