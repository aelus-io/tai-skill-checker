import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { EvaluationService } from '../../modules/evaluation/index.js'
import type { AttemptService } from '../../modules/attempts/index.js'
import type { LiveKitService } from '../../modules/livekit/index.js'
import type { RecordingService } from '../../modules/recordings/index.js'
import { createErrorHandler } from '../error-handler.js'
import { createAttemptRouter } from '../routes/attempts.js'
import { createEvaluationRouter } from '../routes/evaluations.js'

describe('evaluation authorization', () => {
  it('prevents employees from listing, retrying, or reading evaluation reports', async () => {
    const list = vi.fn()
    const retry = vi.fn()
    const getForAttempt = vi.fn()
    const evaluations = { list, retry, getForAttempt } as unknown as EvaluationService
    const app = express()
    app.use((req, _res, next) => { req.authContext = { userId: 'employee', email: 'employee@example.com', organizationId: '00000000-0000-4000-8000-000000000001', role: 'EMPLOYEE' }; next() })
    app.use('/api/admin/evaluations', createEvaluationRouter(evaluations))
    app.use('/api', createAttemptRouter({ attempts: { inspect: vi.fn() } as unknown as AttemptService, livekit: {} as LiveKitService, recordings: {} as RecordingService, evaluations, coverImages: { readForEmployee: vi.fn() } }))
    app.use(createErrorHandler({ error: vi.fn() } as unknown as Logger))

    await request(app).get('/api/admin/evaluations').expect(403)
    await request(app).post('/api/admin/evaluations/00000000-0000-4000-8000-000000000002/retry').expect(403)
    await request(app).get('/api/admin/attempts/00000000-0000-4000-8000-000000000003').expect(403)
    expect(list).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(getForAttempt).not.toHaveBeenCalled()
  })
})
