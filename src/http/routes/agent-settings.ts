import { Router } from 'express'
import { z } from 'zod'
import { agentSettingsSchema, type AgentSettingsService } from '../../modules/agent-settings/index.js'
import type { LiveKitService } from '../../modules/livekit/index.js'
import { getAuthContext, requireRole } from '../middleware/auth.js'

const roomSchema = z.object({ roomName: z.string().min(1).max(255) })

export function createAgentSettingsRouter(dependencies: { settings: AgentSettingsService; livekit: LiveKitService }) {
  const router = Router()
  router.use(requireRole('ADMIN'))
  router.get('/', async (request, response) => {
    const auth = getAuthContext(request)
    response.send({ data: await dependencies.settings.get(auth.organizationId) })
  })
  router.put('/', async (request, response) => {
    const auth = getAuthContext(request)
    response.send({ data: await dependencies.settings.update(auth.organizationId, agentSettingsSchema.parse(request.body)) })
  })
  router.post('/test-session', async (request, response) => {
    const auth = getAuthContext(request)
    response.status(201).send({ data: await dependencies.livekit.createAgentTestSession({ organizationId: auth.organizationId, adminUserId: auth.userId }) })
  })
  router.post('/test-session/end', async (request, response) => {
    const auth = getAuthContext(request)
    const { roomName } = roomSchema.parse(request.body)
    await dependencies.livekit.closeAgentTestSession({ organizationId: auth.organizationId, roomName })
    response.send({ data: { ended: true } })
  })
  return router
}
