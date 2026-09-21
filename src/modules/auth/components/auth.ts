import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import * as schema from '../../../db/schema.js'

export function createAuth(db: Database, config: Pick<AppConfig, 'authSecret' | 'authUrl' | 'frontendUrl'>) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      usePlural: true,
      transaction: true,
    }),
    secret: config.authSecret,
    baseURL: config.authUrl,
    trustedOrigins: [config.frontendUrl],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
