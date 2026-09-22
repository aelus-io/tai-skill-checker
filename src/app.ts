import { randomUUID } from 'node:crypto'
import express from 'express'
import { sql } from 'drizzle-orm'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { pinoHttp } from 'pino-http'
import type { IncomingMessage } from 'node:http'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { AppConfig } from './config/index.js'
import type { Database } from './db/index.js'
import type { Auth } from './modules/auth/index.js'
import { createAssessmentGenerator, createAssessmentService } from './modules/assessments/index.js'
import { createInvitationService } from './modules/invitations/index.js'
import { createAttemptService } from './modules/attempts/index.js'
import { createLiveKitService } from './modules/livekit/index.js'
import { createRecordingService } from './modules/recordings/index.js'
import { createNotificationService } from './modules/notifications/index.js'
import { createOrganizationService } from './modules/organizations/index.js'
import { createResourceService } from './modules/resources/index.js'
import { createErrorHandler, notFoundHandler } from './http/error-handler.js'
import { sanitizeRequestUrl } from './http/logging.js'
import { ForbiddenError } from './http/errors.js'
import { createRequireAuth, getAuthContext, requireRole } from './http/middleware/auth.js'
import { createAssessmentRouter } from './http/routes/assessments.js'
import { createInvitationRouter } from './http/routes/invitations.js'
import { createAttemptRouter } from './http/routes/attempts.js'

export function createApp(dependencies: { config: AppConfig; db: Database; auth: Auth; logger: Logger }) {
  const { config, db, auth, logger } = dependencies
  const app = express()

  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const origin = request.headers.origin
    if (origin === config.frontendUrl) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Vary', 'Origin')
    }
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.sendStatus(204)
      return
    }
    next()
  })
  app.use(pinoHttp({
    logger,
    genReqId: (request: IncomingMessage) => request.headers['x-request-id']?.toString() ?? randomUUID(),
    wrapSerializers: false,
    serializers: {
      req: (request: IncomingMessage) => ({
        method: request.method,
        url: sanitizeRequestUrl(request.url),
        remoteAddress: request.socket.remoteAddress,
      }),
    },
  }))

  // Better Auth must receive the request before Express consumes its body.
  app.all('/api/auth/*splat', toNodeHandler(auth))
  const attempts = createAttemptService(db, config.maxAssessmentAttempts)
  const livekit = createLiveKitService(db, config)
  const recordings = createRecordingService(db, config)
  app.post('/api/webhooks/livekit', express.text({ type: '*/*', limit: '1mb' }), async (request, response) => {
    const event = await livekit.receiveWebhook(request.body as string, request.headers.authorization)
    await livekit.applyRecordingWebhook(event)
    const employeeLeft = event.event === 'participant_left' && event.participant?.identity.startsWith('employee-')
    if ((employeeLeft || event.event === 'room_finished') && event.room?.name) await attempts.abandonByRoom(event.room.name, event.id)
    response.sendStatus(204)
  })
  app.use(express.json({ limit: '1mb' }))

  const assessments = createAssessmentService(db)
  const resources = createResourceService(db, config)
  const generator = createAssessmentGenerator(config)
  const notifications = createNotificationService(config)
  const invitations = createInvitationService(db, notifications, config, logger)
  const organizations = createOrganizationService(db)
  const requireAuth = createRequireAuth(auth, db)

  app.get('/health', async (_request, response) => {
    await db.execute(sql`select 1`)
    response.send({ status: 'ok' })
  })

  app.post('/api/bootstrap', async (request, response) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) throw new ForbiddenError('Sign in before bootstrapping the organization')
    const body = z.object({
      organizationName: z.string().trim().min(1).max(200),
      slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    }).parse(request.body)
    const membership = await organizations.bootstrapAdmin({ userId: session.user.id, ...body })
    response.status(201).send({ data: membership })
  })

  app.get('/api/me', requireAuth, (request, response) => {
    const authContext = getAuthContext(request)
    response.send({ data: { userId: authContext.userId, email: authContext.email, role: authContext.role } })
  })

  app.use('/api/invitations', createInvitationRouter(invitations, auth))
  app.use('/api', requireAuth, createAttemptRouter({ attempts, livekit, recordings }))
  app.use('/api/assessments', requireAuth, requireRole('ADMIN'), createAssessmentRouter({ assessments, resources, generator, invitations, config }))

  app.use(notFoundHandler)
  app.use(createErrorHandler(logger))
  return app
}
