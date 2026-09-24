import { ConflictError } from '../../../http/errors.js'
import { EvaluationExecutionError } from './anthropic.js'

export const evaluationClaimTimeoutMs = 10 * 60 * 1_000

export function staleClaimCutoff(now: Date) {
  return new Date(now.getTime() - evaluationClaimTimeoutMs)
}

type ClaimRow = { id: string; organizationId: string; status: string; claimToken: string | null }

export function assertActiveClaim(
  row: ClaimRow | undefined,
  claim: { id: string; organizationId: string; claimToken: string },
): asserts row is ClaimRow {
  if (!row || row.id !== claim.id || row.organizationId !== claim.organizationId || row.status !== 'PROCESSING' || row.claimToken !== claim.claimToken) {
    throw new EvaluationExecutionError('Evaluation claim is no longer valid')
  }
}

export function assertRetryableEvaluation(evaluationStatus: string, attemptStatus: string) {
  if (evaluationStatus !== 'FAILED') throw new ConflictError('EVALUATION_NOT_RETRYABLE', 'Only failed evaluations can be retried')
  if (attemptStatus !== 'PROCESSING') throw new ConflictError('ATTEMPT_NOT_PROCESSING', 'The attempt is not awaiting evaluation')
}
