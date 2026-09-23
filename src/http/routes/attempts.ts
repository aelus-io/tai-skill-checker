import { Router } from 'express'
import { z } from 'zod'
import type { AttemptService } from '../../modules/attempts/index.js'
import type { LiveKitService } from '../../modules/livekit/index.js'
import type { RecordingService } from '../../modules/recordings/index.js'
import { getAuthContext, requireRole } from '../middleware/auth.js'

export function createAttemptRouter(dependencies: { attempts: AttemptService; livekit: LiveKitService; recordings: RecordingService }) {
  const router = Router()
  router.get('/assignments', requireRole('EMPLOYEE'), async (request, response) => {
    const auth = getAuthContext(request)
    response.send({ data: await dependencies.attempts.listForEmployee({ organizationId: auth.organizationId, userId: auth.userId }) })
  })
  router.get('/assignments/:assignmentId/preparation', requireRole('EMPLOYEE'), async (request, response) => {
    const auth = getAuthContext(request); const params = z.object({ assignmentId: z.uuid() }).parse(request.params)
    response.send({ data: await dependencies.attempts.prepare({ organizationId: auth.organizationId, userId: auth.userId, assignmentId: params.assignmentId }) })
  })
  router.post('/assignments/:assignmentId/attempts', requireRole('EMPLOYEE'), async (request, response) => {
    const auth = getAuthContext(request); const params = z.object({ assignmentId: z.uuid() }).parse(request.params)
    const attempt = await dependencies.attempts.start({ organizationId: auth.organizationId, userId: auth.userId, assignmentId: params.assignmentId })
    try {
      const connection = await dependencies.livekit.provision(attempt)
      response.status(201).send({ data: { attemptId: attempt.id, roomName: attempt.roomName, attemptNumber: attempt.attemptNumber, ...connection } })
    } catch (error) {
      await dependencies.attempts.failStart(attempt, error instanceof Error ? error.message : 'Unknown session provisioning error')
      throw error
    }
  })
  router.post('/attempts/:attemptId/abandon', requireRole('EMPLOYEE'), async (request, response) => {
    const auth = getAuthContext(request); const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params)
    const result = await dependencies.attempts.abandonByEmployee({ organizationId: auth.organizationId, userId: auth.userId, attemptId })
    if (result.roomName) await dependencies.livekit.closeRooms([result.roomName])
    response.send({ data: { status: result.status } })
  })
  router.get('/admin/attempts/active', requireRole('ADMIN'), async (request, response) => { const auth = getAuthContext(request); response.send({ data: await dependencies.attempts.inspectActive(auth.organizationId) }) })
  router.get('/admin/attempts/:attemptId', requireRole('ADMIN'), async (request, response) => { const auth = getAuthContext(request); const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params); response.send({ data: await dependencies.attempts.inspect(auth.organizationId, attemptId) }) })
  router.post('/admin/attempts/:attemptId/observer-token', requireRole('ADMIN'), async (request, response) => { const auth = getAuthContext(request); const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params); response.send({ data: await dependencies.livekit.observerToken({ organizationId: auth.organizationId, attemptId, adminUserId: auth.userId }) }) })
  router.get('/admin/attempts/:attemptId/recording', requireRole('ADMIN'), async (request, response) => { const auth = getAuthContext(request); const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params); response.send({ data: await dependencies.recordings.getPlayback(auth.organizationId, attemptId) }) })
  return router
}
