import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import {
  assessmentVersions,
  assessments,
  assignments,
  competencies,
  invitations,
  organizationMemberships,
} from '../../../db/schema.js'
import { AppError, ConfigurationError, ConflictError, ForbiddenError, NotFoundError } from '../../../http/errors.js'
import type { NotificationService } from '../../notifications/index.js'

const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase()
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function createInvitationService(
  db: Database,
  notifications: NotificationService,
  config: Pick<AppConfig, 'frontendUrl' | 'invitationTtlHours'>,
  logger: Logger,
) {
  async function invite(input: { organizationId: string; assessmentId: string; userId: string; emails: string[] }) {
    if (!notifications.isConfigured) throw new ConfigurationError('Resend invitation delivery')
    const emails = [...new Set(input.emails.map(normalizeEmail))]
    const [assessment] = await db.select().from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    if (!assessment?.currentPublishedVersionId || assessment.status !== 'PUBLISHED') {
      throw new ConflictError('ASSESSMENT_NOT_PUBLISHED', 'Publish the assessment before inviting employees')
    }
    const existing = await db.select({ email: invitations.email }).from(invitations).where(and(
      eq(invitations.organizationId, input.organizationId),
      eq(invitations.assessmentVersionId, assessment.currentPublishedVersionId),
      inArray(invitations.email, emails),
    ))
    if (existing.length) throw new ConflictError('ALREADY_INVITED', `Already invited: ${existing.map((row) => row.email).join(', ')}`)

    const expiresAt = new Date(Date.now() + config.invitationTtlHours * 60 * 60 * 1_000)
    const pending = emails.map((email) => ({ email, token: randomBytes(32).toString('base64url') }))
    const created = await db.transaction(async (tx) => {
      const rows = []
      for (const item of pending) {
        const [invitation] = await tx.insert(invitations).values({
          organizationId: input.organizationId,
          assessmentId: assessment.id,
          assessmentVersionId: assessment.currentPublishedVersionId!,
          email: item.email,
          tokenHash: hashToken(item.token),
          expiresAt,
          createdBy: input.userId,
        }).returning()
        if (!invitation) throw new Error('Invitation insert did not return a row')
        const [assignment] = await tx.insert(assignments).values({
          organizationId: input.organizationId,
          assessmentId: assessment.id,
          assessmentVersionId: assessment.currentPublishedVersionId!,
          invitationId: invitation.id,
          employeeEmail: item.email,
        }).returning()
        if (!assignment) throw new Error('Assignment insert did not return a row')
        rows.push({ invitation, assignment, token: item.token })
      }
      return rows
    })

    const deliveries = await Promise.all(created.map(async (item) => {
      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await notifications.sendInvitation({
              idempotencyKey: `invitation-${item.invitation.id}`,
              to: item.invitation.email,
              assessmentName: assessment.name,
              invitationUrl: `${config.frontendUrl}/invitations/${encodeURIComponent(item.token)}`,
              expiresAt,
            })
            break
          } catch (error) {
            if (attempt === 3) throw error
            await new Promise((resolve) => setTimeout(resolve, attempt * 250))
          }
        }
        await db.update(invitations).set({ emailSentAt: new Date(), emailError: null }).where(eq(invitations.id, item.invitation.id))
        return { invitationId: item.invitation.id, email: item.invitation.email, sent: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown delivery error'
        await db.update(invitations).set({ emailError: message.slice(0, 1_000) }).where(eq(invitations.id, item.invitation.id))
        logger.error({ invitationId: item.invitation.id, organizationId: input.organizationId, err: error }, 'Invitation delivery failed')
        return { invitationId: item.invitation.id, email: item.invitation.email, sent: false as const }
      }
    }))
    return { expiresAt, invitations: deliveries }
  }

  async function preview(rawToken: string) {
    const tokenHash = hashToken(rawToken)
    const [row] = await db.select({
      invitationId: invitations.id,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      email: invitations.email,
      assessmentVersionId: invitations.assessmentVersionId,
      name: assessmentVersions.name,
      description: assessmentVersions.description,
      preparationInstructions: assessmentVersions.preparationInstructions,
    }).from(invitations).innerJoin(assessmentVersions, eq(invitations.assessmentVersionId, assessmentVersions.id)).where(eq(invitations.tokenHash, tokenHash)).limit(1)
    if (!row) throw new NotFoundError('Invitation')
    if (row.status !== 'PENDING') throw new ConflictError('INVITATION_UNAVAILABLE', 'This invitation is no longer available')
    if (row.expiresAt <= new Date()) {
      await db.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, row.invitationId))
      throw new AppError('INVITATION_EXPIRED', 'This invitation has expired', 410)
    }
    const visibleCompetencies = await db.select({ name: competencies.name, description: competencies.description }).from(competencies).where(eq(competencies.assessmentVersionId, row.assessmentVersionId))
    return { email: row.email, expiresAt: row.expiresAt, assessment: { name: row.name, description: row.description, preparationInstructions: row.preparationInstructions, competencies: visibleCompetencies } }
  }

  async function accept(input: { rawToken: string; userId: string; userEmail: string }) {
    const tokenHash = hashToken(input.rawToken)
    const result = await db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).for('update').limit(1)
      if (!invitation) throw new NotFoundError('Invitation')
      if (invitation.status !== 'PENDING') throw new ConflictError('INVITATION_UNAVAILABLE', 'This invitation is no longer available')
      if (invitation.email !== normalizeEmail(input.userEmail)) throw new ForbiddenError('Sign in with the email address that received this invitation')
      if (invitation.expiresAt <= new Date()) {
        await tx.update(invitations).set({ status: 'EXPIRED' }).where(eq(invitations.id, invitation.id))
        return { expired: true as const }
      }

      await tx.update(invitations).set({ status: 'ACCEPTED', acceptedAt: new Date(), tokenHash: hashToken(randomBytes(32).toString('base64url')) }).where(eq(invitations.id, invitation.id))
      const [assignment] = await tx.update(assignments).set({ employeeUserId: input.userId, status: 'READY', updatedAt: new Date() }).where(eq(assignments.invitationId, invitation.id)).returning()
      if (!assignment) throw new Error('Invitation has no assignment')
      await tx.insert(organizationMemberships).values({ organizationId: invitation.organizationId, userId: input.userId, role: 'EMPLOYEE' }).onConflictDoNothing()
      return { expired: false as const, assignment }
    })
    if (result.expired) throw new AppError('INVITATION_EXPIRED', 'This invitation has expired', 410)
    return result.assignment
  }

  return { invite, preview, accept }
}

export type InvitationService = ReturnType<typeof createInvitationService>
