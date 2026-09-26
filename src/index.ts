import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { createLogger, loadConfig } from './config/index.js'
import { createDatabase } from './db/index.js'
import { createAuth, provisionAdminUser } from './modules/auth/index.js'
import { createNotificationService } from './modules/notifications/index.js'
import { createOrganizationService } from './modules/organizations/index.js'
import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicEvaluator, createEvaluationService, createEvaluationWorker } from './modules/evaluation/index.js'
import { createAttemptService } from './modules/attempts/index.js'
import { createLiveKitService, createOrphanSessionReaper } from './modules/livekit/index.js'

const config = loadConfig()
const logger = createLogger(config)
const database = createDatabase(config)
const notifications = createNotificationService(config)
const provisioningAuth = createAuth(database.db, config, notifications.sendMagicLink, { allowPasswordSignUp: true })
const admin = await provisionAdminUser(database.db, provisioningAuth, config)
const organizations = createOrganizationService(database.db)
await organizations.ensureAdminMembership({
  userId: admin.id,
  organizationName: config.organizationName,
  slug: config.organizationSlug,
})
const auth = createAuth(database.db, config, notifications.sendMagicLink)
const anthropic = config.anthropicApiKey ? new Anthropic({
  apiKey: config.anthropicApiKey,
  ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
  ...(config.anthropicWorkspaceId ? { defaultHeaders: { [config.anthropicWorkspaceHeader]: config.anthropicWorkspaceId } } : {}),
  maxRetries: 2,
  timeout: 60_000,
}) : undefined
const evaluator = createAnthropicEvaluator({ ...(anthropic ? { client: anthropic } : {}), ...(config.anthropicEvaluationModel ? { model: config.anthropicEvaluationModel } : {}) })
const evaluations = createEvaluationService(database.db, evaluator)
const evaluationWorker = createEvaluationWorker(evaluations, logger)
const attempts = createAttemptService(database.db, config.maxAssessmentAttempts)
const livekit = createLiveKitService(database.db, config)
const orphanSessionReaper = createOrphanSessionReaper({
  attempts,
  livekit,
  logger,
  timeoutMs: Math.max(config.livekitInactivityTimeoutSeconds, config.livekitTokenTtlSeconds) * 1_000,
})
const app = createApp({ config, db: database.db, auth, logger, evaluations, attempts, livekit })
const server = createServer(app)
let shuttingDown = false

server.listen(config.port, () => {
  evaluationWorker.start()
  orphanSessionReaper.start()
  logger.info({ port: config.port }, 'Backend listening')
})

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'Shutting down')
  const closeServer = new Promise<Error | undefined>((resolve) => {
    server.close((error) => resolve(error))
  })
  await evaluationWorker.stop()
  await orphanSessionReaper.stop()
  const error = await closeServer
  await database.close()
  if (error) {
    logger.error({ err: error }, 'HTTP server shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
