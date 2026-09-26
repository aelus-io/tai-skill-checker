import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import * as schema from '../../../db/schema.js'
import { assessments, invitations, organizationMemberships, users } from '../../../db/schema.js'
import { hashInvitationToken } from '../../invitations/index.js'

type MagicLinkSender = (input: {
  idempotencyKey: string
  kind: 'invitation' | 'employee-login'
  to: string
  assessmentName: string
  magicLinkUrl: string
  expiresAt: Date
}) => Promise<void>

export function createAuth(
  db: Database,
  config: Pick<AppConfig, 'authSecret' | 'authUrl' | 'frontendUrl' | 'magicLinkTtlMinutes'>,
  sendMagicLink: MagicLinkSender,
  options: { allowPasswordSignUp?: boolean } = {},
) {
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
      disableSignUp: !options.allowPasswordSignUp,
      minPasswordLength: 8,
    },
    plugins: [
      magicLink({
        expiresIn: config.magicLinkTtlMinutes * 60,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url, token, metadata }) => {
          const invitationToken = metadata?.invitationToken
          const normalizedEmail = email.trim().toLocaleLowerCase()
          let assessmentName: string
          let kind: 'invitation' | 'employee-login'
          let magicLinkExpiresAt = new Date(Date.now() + config.magicLinkTtlMinutes * 60 * 1_000)

          if (typeof invitationToken === 'string') {
            const [invitation] = await db.select({
              assessmentName: assessments.name,
              expiresAt: invitations.expiresAt,
            }).from(invitations).innerJoin(
              assessments,
              eq(invitations.assessmentId, assessments.id),
            ).where(and(
              eq(invitations.tokenHash, hashInvitationToken(invitationToken)),
              eq(invitations.email, normalizedEmail),
              eq(invitations.status, 'PENDING'),
            )).limit(1)

            if (!invitation || invitation.expiresAt <= new Date()) throw new Error('A valid invitation is required')
            assessmentName = invitation.assessmentName
            kind = 'invitation'
            magicLinkExpiresAt = new Date(Math.min(invitation.expiresAt.getTime(), magicLinkExpiresAt.getTime()))
          } else if (metadata?.purpose === 'employee-login') {
            const [employee] = await db.select({ id: users.id }).from(users).innerJoin(
              organizationMemberships,
              eq(organizationMemberships.userId, users.id),
            ).where(and(
              eq(users.email, normalizedEmail),
              eq(organizationMemberships.role, 'EMPLOYEE'),
            )).limit(1)
            // Keep the public response identical for unknown addresses without sending a link.
            if (!employee) return
            assessmentName = 'your assessment workspace'
            kind = 'employee-login'
          } else {
            throw new Error('A valid invitation is required')
          }

          await sendMagicLink({
            idempotencyKey: `magic-link-${hashInvitationToken(token)}`,
            kind,
            to: email,
            assessmentName,
            magicLinkUrl: url,
            expiresAt: magicLinkExpiresAt,
          })
        },
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
