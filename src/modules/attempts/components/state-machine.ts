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

export function nextAttemptNumber(lastNumber: number | null, maximum: number) {
  const next = (lastNumber ?? 0) + 1
  if (next > maximum) throw new ConflictError('ATTEMPT_LIMIT_REACHED', 'Maximum number of attempts reached')
  return next
}
