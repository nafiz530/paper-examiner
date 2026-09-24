/**
 * POST /api/ai — proxy for the "Provided for you" tier.
 * Secret keys are read from encrypted Cloudflare env vars and never leave the server.
 *
 * Only onRequestPost is exported on purpose. Cloudflare invokes a bare `onRequest` for every method
 * only when no verb-specific handler is exported, so mixing them is ambiguous; other methods simply
 * do not reach this code.
 */
import { handleAI } from '../_lib/handler'
import type { Env } from '../_lib/config'

type Ctx = { request: Request; env: Env }

export const onRequestPost = ({ request, env }: Ctx) => handleAI(request, env)
