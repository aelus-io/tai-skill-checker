export type Role = 'ADMIN' | 'EMPLOYEE'

export type AuthContext = {
  userId: string
  email: string
  organizationId: string
  role: Role
}
