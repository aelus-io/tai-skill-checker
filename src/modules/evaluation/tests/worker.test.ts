import type { Logger } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createEvaluationWorker, type EvaluationService } from '../index.js'

describe('evaluation worker', () => {
  it('executes a claimed database row once and leaves an empty queue alone', async () => {
    const claim = { id: 'evaluation-1', organizationId: 'organization-1', attemptId: 'attempt-1', claimToken: 'claim-1' }
    const claimNext = vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null)
    const execute = vi.fn().mockResolvedValue(undefined)
    const worker = createEvaluationWorker({ claimNext, execute } as unknown as EvaluationService, { info: vi.fn(), error: vi.fn() } as unknown as Logger)
    await worker.runOnce()
    await worker.runOnce()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(claim)
  })

  it('logs the error when a scheduled iteration fails', async () => {
    vi.useFakeTimers()
    const error = new Error('database unavailable')
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger
    const worker = createEvaluationWorker({
      claimNext: vi.fn().mockRejectedValue(error),
      execute: vi.fn(),
    } as unknown as EvaluationService, logger, 5_000)

    worker.start()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(logger.error).toHaveBeenCalledWith({ err: error }, 'Evaluation worker iteration failed')
    await worker.stop()
    vi.useRealTimers()
  })
})
