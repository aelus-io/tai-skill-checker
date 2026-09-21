import { describe, expect, it } from 'vitest'
import { loadConfig } from '../index.js'

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@example.com/test',
  BETTER_AUTH_SECRET: 'a-secure-test-secret-with-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:5173',
}

describe('environment configuration', () => {
  it('applies safe operational defaults', () => {
    const config = loadConfig(valid)
    expect(config).toMatchObject({ port: 3000, invitationTtlHours: 168, maxPdfBytes: 10 * 1024 * 1024 })
  })

  it('requires a sender address when Resend is enabled', () => {
    expect(() => loadConfig({ ...valid, RESEND_API_KEY: 're_test' })).toThrow()
  })
})
