import { Resend } from 'resend'
import type { AppConfig } from '../../../config/index.js'
import { ConfigurationError } from '../../../http/errors.js'

export function createNotificationService(config: Pick<AppConfig, 'resendApiKey' | 'resendFromEmail'>) {
  const resend = config.resendApiKey ? new Resend(config.resendApiKey) : undefined

  async function sendMagicLink(input: { idempotencyKey: string; kind: 'invitation' | 'employee-login'; to: string; assessmentName: string; magicLinkUrl: string; expiresAt: Date }) {
    if (!resend || !config.resendFromEmail) throw new ConfigurationError('Resend invitation delivery')
    const invitation = input.kind === 'invitation'
    const { error } = await resend.emails.send({
      from: config.resendFromEmail,
      to: input.to,
      subject: invitation ? `Invitation: ${input.assessmentName}` : 'Sign in to your assessment workspace',
      text: invitation
        ? `You have been invited to complete ${input.assessmentName}. Use this secure sign-in link before ${input.expiresAt.toISOString()}: ${input.magicLinkUrl}`
        : `Use this secure link to return to your assessments before ${input.expiresAt.toISOString()}: ${input.magicLinkUrl}`,
    }, { idempotencyKey: input.idempotencyKey })
    if (error) throw new Error(`Resend rejected the invitation: ${error.message}`)
  }

  return { sendMagicLink, isConfigured: Boolean(resend && config.resendFromEmail) }
}

export type NotificationService = ReturnType<typeof createNotificationService>
