import { describe, expect, it } from 'vitest'
import { renderMagicLinkEmail } from '../components/email-template.js'

const expiresAt = new Date('2026-09-24T14:30:00.000Z')

describe('notification email templates', () => {
  it('renders a branded assessment invitation with HTML and text fallbacks', () => {
    const email = renderMagicLinkEmail({
      kind: 'invitation',
      assessmentName: 'Applied AI Foundations',
      magicLinkUrl: 'https://example.com/invite/token',
      expiresAt,
    })

    expect(email.subject).toBe('TAI Skill Checker assessment: Applied AI Foundations')
    expect(email.html).toContain('src="https://app.taiskill.berl.dev/assets/logo-BivntQtA.png"')
    expect(email.html).toContain('TAI <span style="color:#666d78; font-weight:600;">Skill Checker</span>')
    expect(email.html).toContain('Open assessment')
    expect(email.html).toContain('Applied AI Foundations')
    expect(email.text).toContain('https://example.com/invite/token')
    expect(email.text).toContain('Sep 24, 2026, 2:30 PM UTC')
    expect(email).not.toHaveProperty('attachments')
  })

  it('renders the returning employee sign-in variant', () => {
    const email = renderMagicLinkEmail({
      kind: 'employee-login',
      assessmentName: 'your assessment workspace',
      magicLinkUrl: 'https://example.com/sign-in/token',
      expiresAt,
    })

    expect(email.subject).toBe('Your TAI Skill Checker sign-in link')
    expect(email.html).toContain('Welcome back')
    expect(email.html).toContain('Sign in')
    expect(email.text).toContain('If you did not request this link')
  })

  it('escapes assessment content and link attributes in HTML', () => {
    const email = renderMagicLinkEmail({
      kind: 'invitation',
      assessmentName: '<script>alert("unsafe")</script>\nInjected header',
      magicLinkUrl: 'https://example.com/?next="unsafe"&source=email',
      expiresAt,
    })

    expect(email.subject).not.toContain('\n')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; Injected header')
    expect(email.html).toContain('next=&quot;unsafe&quot;&amp;source=email')
  })
})
