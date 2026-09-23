import { describe, expect, it } from 'vitest'
import { loadConfig } from '../index.js'

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@example.com/test',
  BETTER_AUTH_SECRET: 'a-secure-test-secret-with-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:5173',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'a-secure-admin-password',
  ORGANIZATION_NAME: 'Example Company',
  ORGANIZATION_SLUG: 'example-company',
}

describe('environment configuration', () => {
  it('applies safe operational defaults', () => {
    const config = loadConfig(valid)
    expect(config).toMatchObject({ port: 3000, invitationTtlHours: 168, magicLinkTtlMinutes: 15, maxPdfBytes: 10 * 1024 * 1024 })
  })

  it('requires a sender address when Resend is enabled', () => {
    expect(() => loadConfig({ ...valid, RESEND_API_KEY: 're_test' })).toThrow()
  })

  it('treats blank optional provider settings as unconfigured', () => {
    const config = loadConfig({ ...valid, LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '' })
    expect(config.livekitUrl).toBeUndefined()
    expect(config.r2Endpoint).toBeUndefined()
  })

  it('rejects a Live-only model for assessment generation', () => {
    expect(() => loadConfig({ ...valid, GEMINI_MODEL: 'gemini-3.1-flash-live-preview' })).toThrow(/must support generateContent/)
  })

  it('requires strong admin bootstrap credentials', () => {
    expect(() => loadConfig({ ...valid, ADMIN_PASSWORD: 'too-short' })).toThrow()
    expect(() => loadConfig({ ...valid, ADMIN_EMAIL: 'not-an-email' })).toThrow()
  })
})
