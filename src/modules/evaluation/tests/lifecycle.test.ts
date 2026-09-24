import { describe, expect, it } from 'vitest'
import { assertActiveClaim, assertRetryableEvaluation, evaluationClaimTimeoutMs, staleClaimCutoff } from '../index.js'

const claim = { id: 'evaluation-1', organizationId: 'organization-1', claimToken: 'token-1' }

describe('evaluation claim and retry lifecycle', () => {
  it('uses a bounded stale-claim recovery cutoff', () => {
    const now = new Date('2026-09-24T12:00:00.000Z')
    expect(staleClaimCutoff(now).getTime()).toBe(now.getTime() - evaluationClaimTimeoutMs)
  })

  it('rejects duplicate, stale, and cross-organization claim completion', () => {
    expect(() => assertActiveClaim({ ...claim, status: 'PROCESSING' }, claim)).not.toThrow()
    expect(() => assertActiveClaim({ ...claim, status: 'COMPLETED' }, claim)).toThrow(/no longer valid/)
    expect(() => assertActiveClaim({ ...claim, status: 'PROCESSING', claimToken: 'stale-token' }, claim)).toThrow(/no longer valid/)
    expect(() => assertActiveClaim({ ...claim, status: 'PROCESSING', organizationId: 'other-organization' }, claim)).toThrow(/no longer valid/)
  })

  it('allows retries only for failed evaluations whose attempts remain processing', () => {
    expect(() => assertRetryableEvaluation('FAILED', 'PROCESSING')).not.toThrow()
    expect(() => assertRetryableEvaluation('COMPLETED', 'COMPLETED')).toThrow(/Only failed/)
    expect(() => assertRetryableEvaluation('FAILED', 'ABANDONED')).toThrow(/not awaiting evaluation/)
  })
})
