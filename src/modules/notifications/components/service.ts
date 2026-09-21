import { Resend } from 'resend'
import type { AppConfig } from '../../../config/index.js'
import { ConfigurationError } from '../../../http/errors.js'

export function createNotificationService(config: Pick<AppConfig, 'resendApiKey' | 'resendFromEmail'>) {
  const resend = config.resendApiKey ? new Resend(config.resendApiKey) : undefined

  async function sendInvitation(input: { idempotencyKey: string; to: string; assessmentName: string; invitationUrl: string; expiresAt: Date }) {
    if (!resend || !config.resendFromEmail) throw new ConfigurationError('Resend invitation delivery')
    const { error } = await resend.emails.send({
      from: config.resendFromEmail,
      to: input.to,
      subject: `Invitation: ${input.assessmentName}`,
      text: `You have been invited to complete ${input.assessmentName}. Open ${input.invitationUrl} before ${input.expiresAt.toISOString()}.`,
    }, { idempotencyKey: input.idempotencyKey })
    if (error) throw new Error(`Resend rejected the invitation: ${error.message}`)
  }

  return { sendInvitation, isConfigured: Boolean(resend && config.resendFromEmail) }
}

export type NotificationService = ReturnType<typeof createNotificationService>
