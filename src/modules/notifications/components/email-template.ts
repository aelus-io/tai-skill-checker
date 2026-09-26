const emailLogoUrl = 'https://app.taiskill.berl.dev/assets/logo-BivntQtA.png'

type MagicLinkEmailInput = {
  kind: 'invitation' | 'employee-login'
  assessmentName: string
  magicLinkUrl: string
  expiresAt: Date
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!)
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function formatExpiry(expiresAt: Date) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(expiresAt) + ' UTC'
}

export function renderMagicLinkEmail(input: MagicLinkEmailInput) {
  const invitation = input.kind === 'invitation'
  const assessmentName = singleLine(input.assessmentName)
  const safeAssessmentName = escapeHtml(assessmentName)
  const safeMagicLinkUrl = escapeHtml(input.magicLinkUrl)
  const expiry = formatExpiry(input.expiresAt)
  const subject = invitation ? `TAI Skill Checker assessment: ${assessmentName}` : 'Your TAI Skill Checker sign-in link'
  const preheader = invitation
    ? `Start ${assessmentName} in TAI Skill Checker.`
    : 'Your link to return to your assessment workspace.'
  const eyebrow = invitation ? 'Assessment' : 'Sign in'
  const heading = invitation ? 'Your assessment is ready' : 'Welcome back'
  const body = invitation
    ? `You have been asked to complete <strong style="color:#0a0b0d;">${safeAssessmentName}</strong> in TAI Skill Checker.`
    : 'Use the button below to return to your TAI Skill Checker assessment workspace.'
  const action = invitation ? 'Open assessment' : 'Sign in'
  const ignored = invitation
    ? 'If you were not expecting this message, no action is needed.'
    : 'If you did not request this link, no action is needed.'

  const text = invitation
    ? `TAI Skill Checker\n\nYou have been asked to complete ${assessmentName}.\n\nOpen assessment: ${input.magicLinkUrl}\n\nThis link expires on ${expiry} and is for your use only.\n\n${ignored}`
    : `TAI Skill Checker\n\nUse this link to return to your assessment workspace:\n${input.magicLinkUrl}\n\nThis link expires on ${expiry} and is for your use only.\n\n${ignored}`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-shell { padding: 20px 12px !important; }
      .email-card { padding: 32px 24px !important; }
      .email-heading { font-size: 30px !important; line-height: 36px !important; }
      .email-button { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f5f7; color:#0a0b0d; font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:#f4f5f7;">
    <tr>
      <td class="email-shell" align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:600px;">
          <tr>
            <td style="padding:0 4px 20px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" valign="middle" style="width:40px; height:40px;"><img src="${emailLogoUrl}" width="40" height="40" alt="TAI Skill Checker" style="display:block; width:40px; height:40px; border:0; border-radius:50%;"></td>
                  <td style="padding-left:12px; font-size:17px; font-weight:700; letter-spacing:-0.3px; color:#0a0b0d;">TAI <span style="color:#666d78; font-weight:600;">Skill Checker</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-card" style="padding:44px 48px; border:1px solid #e0e3e8; border-radius:20px; background:#ffffff; box-shadow:0 10px 30px rgba(10,11,13,0.05);">
              <p style="margin:0 0 14px; color:#d84f08; font-size:12px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase;">${eyebrow}</p>
              <h1 class="email-heading" style="margin:0; color:#0a0b0d; font-size:36px; line-height:42px; font-weight:600; letter-spacing:-1.2px;">${heading}</h1>
              <p style="margin:20px 0 0; color:#4f5662; font-size:16px; line-height:26px;">${body}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:30px;">
                <tr>
                  <td style="border-radius:12px; background:#fa6619;">
                    <a class="email-button" href="${safeMagicLinkUrl}" target="_blank" style="display:inline-block; padding:14px 22px; color:#0a0b0d; font-size:15px; line-height:20px; font-weight:700; text-decoration:none;">${action} &nbsp;→</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin-top:30px;">
                <tr>
                  <td style="padding:16px 18px; border-radius:12px; background:#f7f7f8; color:#666d78; font-size:13px; line-height:20px;">
                    <strong style="color:#353a43;">Link expiry</strong><br>
                    This link expires ${escapeHtml(expiry)} and is for your use only.
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0; color:#7c828a; font-size:12px; line-height:19px;">If the button does not work, open this address in your browser:<br><a href="${safeMagicLinkUrl}" style="color:#c84c0d; word-break:break-all;">${safeMagicLinkUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0; color:#8a9099; font-size:12px; line-height:18px; text-align:center;">${ignored}<br>© ${new Date().getUTCFullYear()} TAI Skill Checker</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return {
    subject,
    text,
    html,
  }
}
