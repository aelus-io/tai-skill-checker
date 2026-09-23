import { eq, sql } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import { organizationMemberships, organizations } from '../../../db/schema.js'
import { ConflictError } from '../../../http/errors.js'

export function createOrganizationService(db: Database) {
  async function ensureAdminMembership(input: { userId: string; organizationName: string; slug: string }) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(734921)`)
      const [existingMembership] = await tx
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, input.userId))
        .limit(1)
      if (existingMembership) {
        if (existingMembership.role === 'ADMIN') return existingMembership
        const [promoted] = await tx.update(organizationMemberships).set({ role: 'ADMIN' }).where(eq(
          organizationMemberships.id,
          existingMembership.id,
        )).returning()
        if (!promoted) throw new Error('Admin membership promotion did not return a row')
        return promoted
      }

      const existingOrganizations = await tx.select().from(organizations).limit(2)
      if (existingOrganizations.length > 1) throw new ConflictError('MULTIPLE_ORGANIZATIONS', 'Admin provisioning requires a single organization')
      const organization = existingOrganizations[0] ?? (await tx.insert(organizations).values({
        name: input.organizationName,
        slug: input.slug,
      }).returning())[0]
      if (!organization) throw new Error('Organization insert did not return a row')

      const [membership] = await tx.insert(organizationMemberships).values({
        organizationId: organization.id,
        userId: input.userId,
        role: 'ADMIN',
      }).returning()
      if (!membership) throw new Error('Membership insert did not return a row')
      return membership
    })
  }

  return { ensureAdminMembership }
}
