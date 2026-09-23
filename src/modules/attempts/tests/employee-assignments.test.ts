import { describe, expect, it } from 'vitest'
import { summarizeEmployeeAssignment } from '../components/service.js'

const assignment = {
  assignmentId: 'assignment-1',
  status: 'READY' as const,
  assessmentId: 'assessment-1',
  name: 'AI foundations',
  description: 'Assessment description',
  attemptsResetAt: null,
  updatedAt: new Date('2026-01-03T00:00:00Z'),
}

describe('employee assignment summaries', () => {
  it('reports retry allowance from consumed attempts', () => {
    const result = summarizeEmployeeAssignment(assignment, [
      { assignmentId: assignment.assignmentId, status: 'ABANDONED', createdAt: new Date('2026-01-02T00:00:00Z') },
      { assignmentId: assignment.assignmentId, status: 'FAILED', createdAt: new Date('2026-01-01T00:00:00Z') },
    ], 3)

    expect(result).toMatchObject({ attemptsUsed: 1, attemptsRemaining: 2, latestAttemptStatus: 'ABANDONED', hasActiveAttempt: false })
  })

  it('ignores attempts before the latest admin reset', () => {
    const result = summarizeEmployeeAssignment({ ...assignment, attemptsResetAt: new Date('2026-01-02T00:00:00Z') }, [
      { assignmentId: assignment.assignmentId, status: 'ABANDONED', createdAt: new Date('2026-01-01T00:00:00Z') },
    ], 3)

    expect(result).toMatchObject({ attemptsUsed: 0, attemptsRemaining: 3, latestAttemptStatus: null })
  })

  it('marks active attempts so the dashboard cannot start a concurrent session', () => {
    const result = summarizeEmployeeAssignment(assignment, [
      { assignmentId: assignment.assignmentId, status: 'IN_PROGRESS', createdAt: new Date('2026-01-03T00:00:00Z') },
    ], 3)

    expect(result.hasActiveAttempt).toBe(true)
  })
})
