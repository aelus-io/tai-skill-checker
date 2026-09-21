import { count, eq, sql } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import { organizationMemberships, organizations } from '../../../db/schema.js'
import { ConflictError } from '../../../http/errors.js'

export function createOrganizationService(db: Database) {
  async function bootstrapAdmin(input: { userId: string; organizationName: string; slug: string }) {
    return db.transaction(async (tx) => {
      // Serialize the one-time bootstrap without requiring a permanent lock table.
      await tx.execute(sql`select pg_advisory_xact_lock(734921)`)
      const [existingMembership] = await tx
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, input.userId))
        .limit(1)
      if (existingMembership) return existingMembership

      const [organizationCount] = await tx.select({ value: count() }).from(organizations)
      if ((organizationCount?.value ?? 0) > 0) {
        throw new ConflictError('ORGANIZATION_ALREADY_BOOTSTRAPPED', 'The organization has already been bootstrapped')
      }

      const [organization] = await tx.insert(organizations).values({
        name: input.organizationName,
        slug: input.slug,
      }).returning()
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

  return { bootstrapAdmin }
}
