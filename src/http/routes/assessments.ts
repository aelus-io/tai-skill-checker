import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { AppConfig } from '../../config/index.js'
import type { AssessmentGenerator, AssessmentService } from '../../modules/assessments/index.js'
import { rubricCriteriaSchema } from '../../modules/assessments/index.js'
import type { InvitationService } from '../../modules/invitations/index.js'
import type { ResourceService } from '../../modules/resources/index.js'
import { AppError } from '../errors.js'
import { getAuthContext } from '../middleware/auth.js'

const idSchema = z.uuid()
const assessmentBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  preparationInstructions: z.string().trim().max(10_000).default(''),
})
const scenarioBody = z.object({
  title: z.string().trim().min(1).max(300),
  prompt: z.string().trim().min(1).max(20_000),
  followUpGuidance: z.string().trim().max(10_000).default(''),
  position: z.number().int().positive(),
})
const competencyBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5_000),
  position: z.number().int().positive(),
})
const rubricBody = z.object({
  competencyId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  criteria: rubricCriteriaSchema,
  expectedBehaviors: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
})

export function createAssessmentRouter(dependencies: {
  assessments: AssessmentService
  generator: AssessmentGenerator
  invitations: InvitationService
  resources: ResourceService
  config: Pick<AppConfig, 'maxPdfBytes'>
}) {
  const router = Router()
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: dependencies.config.maxPdfBytes, files: 1 } })

  router.get('/', async (request, response) => {
    const auth = getAuthContext(request)
    response.send({ data: await dependencies.assessments.list(auth.organizationId) })
  })

  router.post('/', async (request, response) => {
    const auth = getAuthContext(request)
    const body = assessmentBody.parse(request.body)
    const result = await dependencies.assessments.create({ ...auth, ...body })
    response.status(201).send({ data: result })
  })

  router.get('/:assessmentId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.send({ data: await dependencies.assessments.get(auth.organizationId, assessmentId) })
  })

  router.put('/:assessmentId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.send({ data: await dependencies.assessments.update({ ...auth, assessmentId, ...assessmentBody.parse(request.body) }) })
  })

  router.get('/:assessmentId/versions/:versionId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const versionId = idSchema.parse(request.params.versionId)
    response.send({ data: await dependencies.assessments.getVersion(auth.organizationId, assessmentId, versionId) })
  })

  router.post('/:assessmentId/scenarios', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.status(201).send({ data: await dependencies.assessments.addScenario({ ...auth, assessmentId, ...scenarioBody.parse(request.body) }) })
  })

  router.put('/:assessmentId/scenarios/:scenarioId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const scenarioId = idSchema.parse(request.params.scenarioId)
    response.send({ data: await dependencies.assessments.updateScenario({ ...auth, assessmentId, scenarioId, ...scenarioBody.parse(request.body) }) })
  })

  router.post('/:assessmentId/competencies', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.status(201).send({ data: await dependencies.assessments.addCompetency({ ...auth, assessmentId, ...competencyBody.parse(request.body) }) })
  })

  router.put('/:assessmentId/competencies/:competencyId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const competencyId = idSchema.parse(request.params.competencyId)
    response.send({ data: await dependencies.assessments.updateCompetency({ ...auth, assessmentId, competencyId, ...competencyBody.parse(request.body) }) })
  })

  router.post('/:assessmentId/rubrics', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.status(201).send({ data: await dependencies.assessments.addRubric({ ...auth, assessmentId, ...rubricBody.parse(request.body) }) })
  })

  router.put('/:assessmentId/rubrics/:rubricId', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const rubricId = idSchema.parse(request.params.rubricId)
    const { competencyId: _competencyId, ...body } = rubricBody.parse(request.body)
    response.send({ data: await dependencies.assessments.updateRubric({ ...auth, assessmentId, rubricId, ...body }) })
  })

  router.post('/:assessmentId/scenario-competencies', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const body = z.object({ scenarioId: z.uuid(), competencyId: z.uuid() }).parse(request.body)
    response.status(201).send({ data: await dependencies.assessments.mapScenarioCompetency({ ...auth, assessmentId, ...body }) })
  })

  router.post('/:assessmentId/generate', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const body = z.object({ brief: z.string().trim().min(10).max(20_000), sourceText: z.string().trim().min(1).max(100_000).optional() }).parse(request.body)
    const assessment = await dependencies.assessments.requireAssessment(auth.organizationId, assessmentId)
    const content = await dependencies.generator.generate({
      assessmentName: assessment.name,
      brief: body.brief,
      ...(body.sourceText ? { sourceText: body.sourceText } : {}),
    })
    const summary = await dependencies.assessments.replaceDraftContent({ ...auth, assessmentId, content })
    response.status(201).send({ data: { summary, content } })
  })

  router.post('/:assessmentId/resources', upload.single('file'), async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    if (!request.file) throw new AppError('INVALID_UPLOAD', 'A PDF file is required', 400)
    const resource = await dependencies.resources.uploadPdf({
      ...auth,
      assessmentId,
      filename: request.file.originalname,
      mimeType: request.file.mimetype,
      bytes: request.file.buffer,
    })
    response.status(201).send({ data: resource })
  })

  router.post('/:assessmentId/publish', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    response.status(201).send({ data: await dependencies.assessments.publish({ ...auth, assessmentId }) })
  })

  router.post('/:assessmentId/invitations', async (request, response) => {
    const auth = getAuthContext(request)
    const assessmentId = idSchema.parse(request.params.assessmentId)
    const { emails } = z.object({ emails: z.array(z.email()).min(1).max(100) }).parse(request.body)
    response.status(201).send({ data: await dependencies.invitations.invite({ ...auth, assessmentId, emails }) })
  })

  return router
}
