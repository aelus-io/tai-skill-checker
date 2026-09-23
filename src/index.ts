import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { createLogger, loadConfig } from './config/index.js'
import { createDatabase } from './db/index.js'
import { createAuth, provisionAdminUser } from './modules/auth/index.js'
import { createNotificationService } from './modules/notifications/index.js'
import { createOrganizationService } from './modules/organizations/index.js'

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
const app = createApp({ config, db: database.db, auth, logger })
const server = createServer(app)

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'Backend listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down')
  server.close(async (error) => {
    await database.close()
    if (error) {
      logger.error({ err: error }, 'HTTP server shutdown failed')
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
