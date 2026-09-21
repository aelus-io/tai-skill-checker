import { eq } from 'drizzle-orm'
import type { RequestHandler } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import type { Database } from '../../db/index.js'
import { organizationMemberships } from '../../db/schema.js'
import type { Auth, AuthContext, Role } from '../../modules/auth/index.js'
import { ForbiddenError } from '../errors.js'

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext
    }
  }
}

export function createRequireAuth(auth: Auth, db: Database): RequestHandler {
  return async (request, _response, next) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
      if (!session) {
        throw new ForbiddenError('Authentication is required')
      }

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, session.user.id))
        .limit(1)

      if (!membership) {
        throw new ForbiddenError('No organization membership exists for this user')
      }

      request.authContext = {
        userId: session.user.id,
        email: session.user.email,
        organizationId: membership.organizationId,
        role: membership.role,
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.authContext || !roles.includes(request.authContext.role)) {
      next(new ForbiddenError())
      return
    }
    next()
  }
}

export function getAuthContext(request: Express.Request): AuthContext {
  if (!request.authContext) throw new ForbiddenError('Authentication is required')
  return request.authContext
}
