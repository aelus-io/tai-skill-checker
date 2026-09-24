import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { AttemptService } from '../../modules/attempts/index.js'
import type { LiveKitService } from '../../modules/livekit/index.js'
import type { RecordingService } from '../../modules/recordings/index.js'
import { createAttemptRouter } from '../routes/attempts.js'

describe('employee attempt abandonment', () => {
  it('persists the authenticated employee attempt before closing its room', async () => {
    const abandonByEmployee = vi.fn().mockResolvedValue({ status: 'ABANDONED', roomName: 'assessment-attempt-1' })
    const closeRooms = vi.fn().mockResolvedValue(undefined)
    const app = express()
    app.use((req, _res, next) => {
      req.authContext = {
        userId: 'employee-1',
        email: 'employee@example.com',
        organizationId: '00000000-0000-4000-8000-000000000001',
        role: 'EMPLOYEE',
      }
      next()
    })
    app.use('/api', createAttemptRouter({
      attempts: { abandonByEmployee } as unknown as AttemptService,
      livekit: { closeRooms } as unknown as LiveKitService,
      recordings: {} as RecordingService,
      evaluations: { getForAttempt: vi.fn() },
    }))

    const response = await request(app)
      .post('/api/attempts/00000000-0000-4000-8000-000000000002/abandon')
      .expect(200)

    expect(abandonByEmployee).toHaveBeenCalledWith({
      organizationId: '00000000-0000-4000-8000-000000000001',
      userId: 'employee-1',
      attemptId: '00000000-0000-4000-8000-000000000002',
    })
    expect(closeRooms).toHaveBeenCalledWith(['assessment-attempt-1'])
    expect(response.body).toEqual({ data: { status: 'ABANDONED' } })
  })
})
