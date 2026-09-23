import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../../../db/index.js'
import type { Auth } from '../index.js'
import { provisionAdminUser } from '../index.js'

const config = {
  adminEmail: 'admin@example.com',
  adminName: 'Admin',
  adminPassword: 'a-secure-admin-password',
  frontendUrl: 'http://localhost:5173',
}

function databaseWithSelectResults(results: unknown[][], deleteWhere = vi.fn(async () => undefined)) {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => results.shift() ?? [],
        }),
      }),
    })),
    delete: vi.fn(() => ({ where: deleteWhere })),
  } as unknown as Database
}

describe('admin user provisioning', () => {
  it('reuses an existing password-backed admin user', async () => {
    const user = { id: 'admin-user', email: config.adminEmail }
    const db = databaseWithSelectResults([[user], [{ id: 'credential-account' }]])
    const signUpEmail = vi.fn()
    const auth = { api: { signUpEmail } } as unknown as Auth

    await expect(provisionAdminUser(db, auth, config)).resolves.toBe(user)
    expect(signUpEmail).not.toHaveBeenCalled()
  })

  it('creates the initial admin through Better Auth and removes its unused bootstrap session', async () => {
    const user = { id: 'new-admin', email: config.adminEmail }
    const deleteWhere = vi.fn(async () => undefined)
    const db = databaseWithSelectResults([[]], deleteWhere)
    const signUpEmail = vi.fn(async () => ({ user, token: 'unused-bootstrap-session' }))
    const auth = { api: { signUpEmail } } as unknown as Auth

    await expect(provisionAdminUser(db, auth, config)).resolves.toBe(user)
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ email: config.adminEmail }) }))
    expect(deleteWhere).toHaveBeenCalledOnce()
  })

  it('rejects an existing email without password credentials', async () => {
    const user = { id: 'magic-link-user', email: config.adminEmail }
    const db = databaseWithSelectResults([[user], []])
    const auth = { api: { signUpEmail: vi.fn() } } as unknown as Auth

    await expect(provisionAdminUser(db, auth, config)).rejects.toThrow('exists without password credentials')
  })
})
