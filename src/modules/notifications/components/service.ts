import { Resend } from 'resend'
import type { AppConfig } from '../../../config/index.js'
import { ConfigurationError } from '../../../http/errors.js'
import { renderMagicLinkEmail } from './email-template.js'

export function createNotificationService(config: Pick<AppConfig, 'resendApiKey' | 'resendFromEmail'>) {
  const resend = config.resendApiKey ? new Resend(config.resendApiKey) : undefined

  async function sendMagicLink(input: { idempotencyKey: string; kind: 'invitation' | 'employee-login'; to: string; assessmentName: string; magicLinkUrl: string; expiresAt: Date }) {
    if (!resend || !config.resendFromEmail) throw new ConfigurationError('Resend invitation delivery')
    const email = renderMagicLinkEmail(input)
    const { error } = await resend.emails.send({
      from: `TAI Skill Checker <${config.resendFromEmail}>`,
      to: input.to,
      ...email,
    }, { idempotencyKey: input.idempotencyKey })
    if (error) throw new Error(`Resend rejected the email: ${error.message}`)
  }

  return { sendMagicLink, isConfigured: Boolean(resend && config.resendFromEmail) }
}

export type NotificationService = ReturnType<typeof createNotificationService>
