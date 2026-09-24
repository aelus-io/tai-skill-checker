import { Router } from 'express'
import { z } from 'zod'
import type { EvaluationService } from '../../modules/evaluation/index.js'
import { getAuthContext, requireRole } from '../middleware/auth.js'

const filtersSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  assessmentId: z.uuid().optional(),
}).strict()

export function createEvaluationRouter(evaluations: EvaluationService) {
  const router = Router()
  router.use(requireRole('ADMIN'))
  router.get('/', async (request, response) => {
    const auth = getAuthContext(request)
    response.send({ data: await evaluations.list(auth.organizationId, filtersSchema.parse(request.query)) })
  })
  router.post('/:evaluationId/retry', async (request, response) => {
    const auth = getAuthContext(request)
    const { evaluationId } = z.object({ evaluationId: z.uuid() }).parse(request.params)
    const evaluation = await evaluations.retry(auth.organizationId, evaluationId)
    response.send({ data: { id: evaluation.id, status: evaluation.status } })
  })
  return router
}
