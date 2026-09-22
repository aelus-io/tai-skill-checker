import { describe, expect, it } from 'vitest'
import { assertAttemptAvailable, canTransitionAttempt, nextAttemptNumber, remainingAttempts } from '../index.js'

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

  it('enforces each attempt window while keeping audit numbers monotonic', () => {
    expect(nextAttemptNumber(null)).toBe(1)
    expect(nextAttemptNumber(3)).toBe(4)
    expect(remainingAttempts(0, 3)).toBe(3)
    expect(remainingAttempts(2, 3)).toBe(1)
    expect(() => assertAttemptAvailable(3, 3)).toThrowError(expect.objectContaining({ code: 'ATTEMPT_LIMIT_REACHED' }))
    expect(() => assertAttemptAvailable(0, 3)).not.toThrow()
  })
})
