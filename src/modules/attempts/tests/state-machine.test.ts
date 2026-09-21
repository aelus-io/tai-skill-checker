import { describe, expect, it } from 'vitest'
import { canTransitionAttempt, nextAttemptNumber } from '../index.js'

describe('attempt state machine', () => {
  it('permits the successful flow and interruption from an active session', () => {
    expect(canTransitionAttempt('READY', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionAttempt('IN_PROGRESS', 'PROCESSING')).toBe(true)
    expect(canTransitionAttempt('PROCESSING', 'COMPLETED')).toBe(true)
    expect(canTransitionAttempt('IN_PROGRESS', 'ABANDONED')).toBe(true)
  })

  it('makes consumed and completed attempts terminal', () => {
    for (const status of ['COMPLETED', 'ABANDONED', 'FAILED', 'EXPIRED'] as const) {
      expect(canTransitionAttempt(status, 'IN_PROGRESS')).toBe(false)
    }
    expect(canTransitionAttempt('PROCESSING', 'IN_PROGRESS')).toBe(false)
  })

  it('counts every started attempt and rejects the configured limit', () => {
    expect(nextAttemptNumber(null, 3)).toBe(1)
    expect(nextAttemptNumber(2, 3)).toBe(3)
    expect(() => nextAttemptNumber(3, 3)).toThrowError(expect.objectContaining({ code: 'ATTEMPT_LIMIT_REACHED' }))
  })
})
