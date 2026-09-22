import type { AttemptStatus } from '../types/index.js'
import { ConflictError } from '../../../http/errors.js'

const transitions: Record<AttemptStatus, readonly AttemptStatus[]> = {
  READY: ['IN_PROGRESS', 'EXPIRED'],
  IN_PROGRESS: ['PROCESSING', 'ABANDONED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [], ABANDONED: [], FAILED: [], EXPIRED: [],
}

export function canTransitionAttempt(from: AttemptStatus, to: AttemptStatus) {
  return transitions[from].includes(to)
}

export function assertAttemptAvailable(used: number, maximum: number) {
  if (used >= maximum) throw new ConflictError('ATTEMPT_LIMIT_REACHED', 'Maximum number of attempts reached')
}

export function nextAttemptNumber(lastNumber: number | null) {
  return (lastNumber ?? 0) + 1
}

export function remainingAttempts(used: number, maximum: number) {
  return Math.max(0, maximum - used)
}
