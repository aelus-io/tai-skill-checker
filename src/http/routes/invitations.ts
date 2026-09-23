import { Router } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { z } from 'zod'
import type { Auth } from '../../modules/auth/index.js'
import type { InvitationService } from '../../modules/invitations/index.js'
import { ForbiddenError } from '../errors.js'

const tokenSchema = z.string().min(20).max(200)

export function createInvitationRouter(invitations: InvitationService, auth: Auth) {
  const router = Router()

  router.get('/:token', async (request, response) => {
    response.send({ data: await invitations.preview(tokenSchema.parse(request.params.token)) })
  })

  router.post('/:token/sign-in', async (request, response) => {
    await invitations.requestSignIn(tokenSchema.parse(request.params.token))
    response.status(202).send({ data: { sent: true } })
  })

  router.post('/:token/accept', async (request, response) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) throw new ForbiddenError('Sign in before accepting this invitation')
    const assignment = await invitations.accept({
      rawToken: tokenSchema.parse(request.params.token),
      userId: session.user.id,
      userEmail: session.user.email,
    })
    response.send({ data: assignment })
  })

  return router
}
