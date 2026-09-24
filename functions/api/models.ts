/** GET /api/models — key-free list of providers/models this deployment offers. */
import { handleModels } from '../_lib/handler'
import type { Env } from '../_lib/config'

type Ctx = { request: Request; env: Env }

export const onRequestGet = ({ request, env }: Ctx) => handleModels(request, env)
