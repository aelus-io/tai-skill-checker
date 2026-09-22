import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import {
  assessmentVersions,
  assessments,
  assignments,
  attempts,
  attemptEvents,
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
  config: Pick<AppConfig, 'frontendUrl' | 'invitationTtlHours' | 'maxAssessmentAttempts'>,
  logger: Logger,
  closeRooms: (roomNames: string[]) => Promise<void>,
) {
  async function deliverInvitation(input: { invitationId: string; organizationId: string; email: string; assessmentName: string; token: string; expiresAt: Date; idempotencyKey: string }) {
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await notifications.sendInvitation({
            idempotencyKey: input.idempotencyKey,
            to: input.email,
            assessmentName: input.assessmentName,
            invitationUrl: `${config.frontendUrl}/invitations/${encodeURIComponent(input.token)}`,
            expiresAt: input.expiresAt,
          })
          break
        } catch (error) {
          if (attempt === 3) throw error
          await new Promise((resolve) => setTimeout(resolve, attempt * 250))
        }
      }
      await db.update(invitations).set({ emailSentAt: new Date(), emailError: null }).where(eq(invitations.id, input.invitationId))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown delivery error'
      await db.update(invitations).set({ emailError: message.slice(0, 1_000) }).where(eq(invitations.id, input.invitationId))
      logger.error({ invitationId: input.invitationId, organizationId: input.organizationId, err: error }, 'Invitation delivery failed')
      return false
    }
  }

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

    const deliveries = await Promise.all(created.map(async (item) => ({
      invitationId: item.invitation.id,
      email: item.invitation.email,
      sent: await deliverInvitation({
        invitationId: item.invitation.id,
        organizationId: input.organizationId,
        email: item.invitation.email,
        assessmentName: assessment.name,
        token: item.token,
        expiresAt,
        idempotencyKey: `invitation-${item.invitation.id}`,
      }),
    })))
    return { expiresAt, invitations: deliveries }
  }

  async function list(input: { organizationId: string; assessmentId: string }) {
    const rows = await db.select({
      invitationId: invitations.id,
      assignmentId: assignments.id,
      email: invitations.email,
      invitationStatus: invitations.status,
      assignmentStatus: assignments.status,
      expiresAt: invitations.expiresAt,
      attemptsResetAt: assignments.attemptsResetAt,
    }).from(invitations).innerJoin(assignments, eq(assignments.invitationId, invitations.id)).where(and(
      eq(invitations.organizationId, input.organizationId),
      eq(invitations.assessmentId, input.assessmentId),
    )).orderBy(asc(invitations.email))
    const history = rows.length ? await db.select({ assignmentId: attempts.assignmentId, createdAt: attempts.createdAt, status: attempts.status }).from(attempts).where(and(
      eq(attempts.organizationId, input.organizationId),
      inArray(attempts.assignmentId, rows.map((row) => row.assignmentId)),
    )) : []
    return rows.map(({ attemptsResetAt, ...row }) => {
      const currentAttempts = history.filter((attempt) => attempt.assignmentId === row.assignmentId && (!attemptsResetAt || attempt.createdAt > attemptsResetAt))
      return {
        ...row,
        attemptsUsed: currentAttempts.length,
        attemptsRemaining: Math.max(0, config.maxAssessmentAttempts - currentAttempts.length),
        hasActiveAttempt: history.some((attempt) => attempt.assignmentId === row.assignmentId && (attempt.status === 'IN_PROGRESS' || attempt.status === 'PROCESSING')),
      }
    })
  }

  async function reinvite(input: { organizationId: string; assessmentId: string; invitationId: string; userId: string }) {
    if (!notifications.isConfigured) throw new ConfigurationError('Resend invitation delivery')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + config.invitationTtlHours * 60 * 60 * 1_000)
    const resetAt = new Date()
    const result = await db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(invitations).where(and(
        eq(invitations.id, input.invitationId),
        eq(invitations.organizationId, input.organizationId),
        eq(invitations.assessmentId, input.assessmentId),
      )).for('update').limit(1)
      if (!invitation) throw new NotFoundError('Invitation')
      const [assignment] = await tx.select().from(assignments).where(and(
        eq(assignments.invitationId, invitation.id),
        eq(assignments.organizationId, input.organizationId),
      )).for('update').limit(1)
      if (!assignment) throw new NotFoundError('Assignment')
      const active = await tx.select({ id: attempts.id, roomName: attempts.roomName }).from(attempts).where(and(
        eq(attempts.assignmentId, assignment.id),
        inArray(attempts.status, ['IN_PROGRESS', 'PROCESSING']),
      ))
      if (active.length) {
        await tx.update(attempts).set({ status: 'ABANDONED', updatedAt: resetAt }).where(inArray(attempts.id, active.map((attempt) => attempt.id)))
        await tx.insert(attemptEvents).values(active.map((attempt) => ({
          organizationId: input.organizationId,
          attemptId: attempt.id,
          type: 'ADMIN_REINVITE_RESET',
          payload: { resetBy: input.userId },
          idempotencyKey: `admin-reinvite-reset-${resetAt.toISOString()}`,
        })))
      }
      await tx.update(invitations).set({
        status: 'PENDING',
        tokenHash: hashToken(token),
        expiresAt,
        acceptedAt: null,
        emailSentAt: null,
        emailError: null,
        createdBy: input.userId,
      }).where(eq(invitations.id, invitation.id))
      await tx.update(assignments).set({ status: 'PENDING', attemptsResetAt: resetAt, updatedAt: resetAt }).where(eq(assignments.id, assignment.id))
      const [assessment] = await tx.select({ name: assessments.name }).from(assessments).where(and(
        eq(assessments.id, invitation.assessmentId),
        eq(assessments.organizationId, input.organizationId),
      )).limit(1)
      if (!assessment) throw new NotFoundError('Assessment')
      return { invitation, assessment, roomNames: active.flatMap((attempt) => attempt.roomName ? [attempt.roomName] : []) }
    })
    await closeRooms(result.roomNames)
    const sent = await deliverInvitation({
      invitationId: result.invitation.id,
      organizationId: input.organizationId,
      email: result.invitation.email,
      assessmentName: result.assessment.name,
      token,
      expiresAt,
      idempotencyKey: `reinvitation-${result.invitation.id}-${hashToken(token).slice(0, 12)}`,
    })
    return { invitationId: result.invitation.id, email: result.invitation.email, expiresAt, sent, attemptsRemaining: config.maxAssessmentAttempts }
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

  return { invite, list, reinvite, preview, accept }
}

export type InvitationService = ReturnType<typeof createInvitationService>
