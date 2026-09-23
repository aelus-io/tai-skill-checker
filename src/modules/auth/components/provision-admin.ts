import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { accounts, sessions, users } from '../../../db/schema.js'
import type { Auth } from './auth.js'

export async function provisionAdminUser(
  db: Database,
  auth: Auth,
  config: Pick<AppConfig, 'adminEmail' | 'adminName' | 'adminPassword' | 'frontendUrl'>,
) {
  async function findExistingAdmin() {
    const [existing] = await db.select().from(users).where(eq(users.email, config.adminEmail)).limit(1)
    if (!existing) return undefined
    const [credential] = await db.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.userId, existing.id),
      eq(accounts.providerId, 'credential'),
    )).limit(1)
    if (!credential) throw new Error(`The configured admin email ${config.adminEmail} exists without password credentials`)
    return existing
  }

  const existing = await findExistingAdmin()
  if (existing) return existing

  let created
  try {
    created = await auth.api.signUpEmail({
      headers: new Headers({ origin: config.frontendUrl }),
      body: {
        name: config.adminName,
        email: config.adminEmail,
        password: config.adminPassword,
      },
    })
  } catch (error) {
    const concurrentlyCreated = await findExistingAdmin()
    if (concurrentlyCreated) return concurrentlyCreated
    throw error
  }
  await db.delete(sessions).where(eq(sessions.userId, created.user.id))
  return created.user
}
