import { describe, expect, it } from 'vitest'
import { sanitizeRequestUrl } from '../logging.js'

describe('request URL sanitization', () => {
  it('removes invitation bearer secrets and query strings', () => {
    expect(sanitizeRequestUrl('/api/invitations/raw-secret/accept?callback=private')).toBe('/api/invitations/[REDACTED]/accept')
  })

  it('keeps ordinary route paths useful', () => {
    expect(sanitizeRequestUrl('/api/assessments/123?view=draft')).toBe('/api/assessments/123')
  })
})
