import { and, asc, count, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import { coverImageUrl } from '../../assessments/index.js'
import { assessments, assignments, attempts, attemptEvents, attemptScenarios, attemptTurns, assessmentVersions, competencies, evaluations, scenarios, users } from '../../../db/schema.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../../http/errors.js'
import { assertAttemptAvailable, canTransitionAttempt, nextAttemptNumber, remainingAttempts } from './state-machine.js'
import type { AttemptSpeaker, AttemptStatus, StartedAttempt } from '../types/index.js'

const consumedAttemptStatuses: AttemptStatus[] = ['IN_PROGRESS', 'PROCESSING', 'COMPLETED', 'ABANDONED']

type EmployeeAssignmentRow = {
  assignmentId: string
  status: 'PENDING' | 'READY' | 'COMPLETED' | 'EXPIRED'
  assessmentId: string
  name: string
  description: string
  coverImageKey?: string | null
  attemptsResetAt: Date | null
  updatedAt: Date
}

type EmployeeAttemptRow = {
  assignmentId: string
  status: AttemptStatus
  createdAt: Date
}

export function summarizeEmployeeAssignment(row: EmployeeAssignmentRow, history: EmployeeAttemptRow[], maxAttempts: number) {
  const currentAttempts = history.filter((attempt) => (
    attempt.assignmentId === row.assignmentId
    && consumedAttemptStatuses.includes(attempt.status)
    && (!row.attemptsResetAt || attempt.createdAt > row.attemptsResetAt)
  ))
  return {
    assignmentId: row.assignmentId,
    status: row.status,
    assessmentId: row.assessmentId,
    name: row.name,
    description: row.description,
    coverImageUrl: coverImageUrl(`/api/assignments/${row.assignmentId}/cover`, row.coverImageKey ?? null),
    updatedAt: row.updatedAt,
    attemptsUsed: currentAttempts.length,
    attemptsRemaining: remainingAttempts(currentAttempts.length, maxAttempts),
    latestAttemptStatus: currentAttempts[0]?.status ?? null,
    hasActiveAttempt: currentAttempts.some((attempt) => attempt.status === 'IN_PROGRESS' || attempt.status === 'PROCESSING'),
  }
}

export function createAttemptService(db: Database, maxAttempts: number) {
  async function listForEmployee(input: { organizationId: string; userId: string }) {
    const rows = await db.select({
      assignmentId: assignments.id,
      status: assignments.status,
      assessmentId: assignments.assessmentId,
      name: assessmentVersions.name,
      description: assessmentVersions.description,
      coverImageKey: assessments.coverImageKey,
      attemptsResetAt: assignments.attemptsResetAt,
      updatedAt: assignments.updatedAt,
    }).from(assignments).innerJoin(
      assessmentVersions,
      eq(assignments.assessmentVersionId, assessmentVersions.id),
    ).innerJoin(assessments, eq(assignments.assessmentId, assessments.id)).where(and(
      eq(assignments.organizationId, input.organizationId),
      eq(assignments.employeeUserId, input.userId),
    )).orderBy(desc(assignments.updatedAt))

    const history = rows.length ? await db.select({
      assignmentId: attempts.assignmentId,
      status: attempts.status,
      createdAt: attempts.createdAt,
    }).from(attempts).where(and(
      eq(attempts.organizationId, input.organizationId),
      inArray(attempts.assignmentId, rows.map((row) => row.assignmentId)),
    )).orderBy(desc(attempts.createdAt)) : []

    return rows.map((row) => summarizeEmployeeAssignment(row, history, maxAttempts))
  }

  async function prepare(input: { organizationId: string; assignmentId: string; userId: string }) {
    const [row] = await db.select({
      assignmentId: assignments.id, status: assignments.status, assessmentId: assignments.assessmentId,
      assessmentVersionId: assignments.assessmentVersionId, attemptsResetAt: assignments.attemptsResetAt, name: assessmentVersions.name,
      description: assessmentVersions.description, preparationInstructions: assessmentVersions.preparationInstructions,
      coverImageKey: assessments.coverImageKey,
    }).from(assignments).innerJoin(assessmentVersions, eq(assignments.assessmentVersionId, assessmentVersions.id)).innerJoin(assessments, eq(assignments.assessmentId, assessments.id)).where(and(
      eq(assignments.id, input.assignmentId), eq(assignments.organizationId, input.organizationId), eq(assignments.employeeUserId, input.userId),
    )).limit(1)
    if (!row) throw new NotFoundError('Assignment')
    const [usage, visibleCompetencies] = await Promise.all([
      db.select({ used: count() }).from(attempts).where(and(
        eq(attempts.assignmentId, input.assignmentId),
        inArray(attempts.status, consumedAttemptStatuses),
        row.attemptsResetAt ? gt(attempts.createdAt, row.attemptsResetAt) : undefined,
      )).then((rows) => rows[0]),
      db.select({ name: competencies.name, description: competencies.description }).from(competencies).where(and(
        eq(competencies.organizationId, input.organizationId),
        eq(competencies.assessmentVersionId, row.assessmentVersionId),
      )).orderBy(asc(competencies.position)),
    ])
    const used = usage?.used ?? 0
    const { attemptsResetAt: _attemptsResetAt, coverImageKey, ...preparation } = row
    return { ...preparation, coverImageUrl: coverImageUrl(`/api/assignments/${row.assignmentId}/cover`, coverImageKey), competencies: visibleCompetencies, attemptsUsed: used, attemptsRemaining: remainingAttempts(used, maxAttempts) }
  }

  async function start(input: { organizationId: string; assignmentId: string; userId: string }): Promise<StartedAttempt> {
    return db.transaction(async (tx) => {
      const [assignment] = await tx.select().from(assignments).where(and(
        eq(assignments.id, input.assignmentId), eq(assignments.organizationId, input.organizationId),
      )).for('update').limit(1)
      if (!assignment) throw new NotFoundError('Assignment')
      if (assignment.employeeUserId !== input.userId) throw new ForbiddenError()
      if (assignment.status === 'COMPLETED') throw new ConflictError('ASSIGNMENT_LOCKED', 'This assessment has already been completed')
      if (assignment.status !== 'READY') throw new ConflictError('ASSIGNMENT_NOT_READY', 'This assignment cannot be started')
      const [activeAttempt] = await tx.select({ id: attempts.id }).from(attempts).where(and(
        eq(attempts.assignmentId, assignment.id),
        inArray(attempts.status, ['IN_PROGRESS', 'PROCESSING']),
      )).limit(1)
      if (activeAttempt) throw new ConflictError('ATTEMPT_ALREADY_ACTIVE', 'An assessment attempt is already active')
      const [usage] = await tx.select({ used: count() }).from(attempts).where(and(
        eq(attempts.assignmentId, assignment.id),
        inArray(attempts.status, consumedAttemptStatuses),
        assignment.attemptsResetAt ? gt(attempts.createdAt, assignment.attemptsResetAt) : undefined,
      ))
      assertAttemptAvailable(usage?.used ?? 0, maxAttempts)
      const [numberRow] = await tx.select({ lastNumber: max(attempts.attemptNumber) }).from(attempts).where(eq(attempts.assignmentId, assignment.id))
      const lastNumber = numberRow?.lastNumber ?? 0
      const attemptNumber = nextAttemptNumber(lastNumber)
      const orderedScenarios = await tx.select({ id: scenarios.id, position: scenarios.position }).from(scenarios).where(and(
        eq(scenarios.organizationId, input.organizationId), eq(scenarios.assessmentVersionId, assignment.assessmentVersionId),
      )).orderBy(asc(scenarios.position))
      if (!orderedScenarios.length) throw new ConflictError('ASSESSMENT_HAS_NO_SCENARIOS', 'The published assessment has no scenarios')
      const [attempt] = await tx.insert(attempts).values({
        organizationId: input.organizationId, assignmentId: assignment.id, assessmentId: assignment.assessmentId,
        assessmentVersionId: assignment.assessmentVersionId, employeeUserId: input.userId, status: 'IN_PROGRESS',
        attemptNumber, startedAt: new Date(), lastHeartbeatAt: new Date(), currentScenarioId: orderedScenarios[0]!.id,
      }).returning()
      if (!attempt) throw new Error('Attempt insert did not return a row')
      const roomName = `assessment-attempt-${attempt.id}`
      await tx.update(attempts).set({ roomName }).where(eq(attempts.id, attempt.id))
      await tx.insert(attemptScenarios).values(orderedScenarios.map((scenario) => ({ organizationId: input.organizationId, attemptId: attempt.id, scenarioId: scenario.id, position: scenario.position })))
      await tx.insert(attemptEvents).values({ organizationId: input.organizationId, attemptId: attempt.id, type: 'ATTEMPT_STARTED', payload: { attemptNumber }, idempotencyKey: 'attempt-started' })
      return { ...attempt, roomName }
    })
  }

  async function transition(input: { organizationId: string; attemptId: string; to: AttemptStatus; eventType: string; idempotencyKey?: string; payload?: Record<string, unknown> }) {
    return db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, input.organizationId))).for('update').limit(1)
      if (!attempt) throw new NotFoundError('Attempt')
      if (attempt.status === input.to) return attempt
      if (!canTransitionAttempt(attempt.status, input.to)) throw new ConflictError('INVALID_ATTEMPT_TRANSITION', `Cannot move attempt from ${attempt.status} to ${input.to}`)
      const now = new Date()
      const [updated] = await tx.update(attempts).set({ status: input.to, updatedAt: now, ...(input.to === 'COMPLETED' ? { completedAt: now } : {}) }).where(eq(attempts.id, attempt.id)).returning()
      await tx.insert(attemptEvents).values({ organizationId: input.organizationId, attemptId: attempt.id, type: input.eventType, payload: input.payload ?? {}, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }).onConflictDoNothing()
      return updated!
    })
  }

  async function failStart(attempt: StartedAttempt, reason: string) {
    const [failed] = await db.update(attempts).set({ status: 'FAILED', updatedAt: new Date() }).where(and(eq(attempts.id, attempt.id), eq(attempts.organizationId, attempt.organizationId), eq(attempts.status, 'IN_PROGRESS'))).returning({ id: attempts.id })
    if (failed) await recordEvent({ organizationId: attempt.organizationId, attemptId: attempt.id, type: 'SESSION_START_FAILED', payload: { reason: reason.slice(0, 500) }, idempotencyKey: 'session-start-failed' })
  }

  async function appendTurn(input: { organizationId: string; attemptId: string; speaker: AttemptSpeaker; content: string; scenarioId?: string; startedAt?: Date; endedAt?: Date }) {
    return db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, input.organizationId))).for('update').limit(1)
      if (!attempt) throw new NotFoundError('Attempt')
      if (!inArrayValue(attempt.status, ['IN_PROGRESS', 'PROCESSING'])) throw new ConflictError('ATTEMPT_NOT_ACTIVE', 'Transcript is closed for this attempt')
      const [sequenceRow] = await tx.select({ lastSequence: max(attemptTurns.sequence) }).from(attemptTurns).where(eq(attemptTurns.attemptId, attempt.id))
      const lastSequence = sequenceRow?.lastSequence ?? 0
      const [turn] = await tx.insert(attemptTurns).values({ organizationId: input.organizationId, attemptId: attempt.id, speaker: input.speaker, content: input.content, sequence: (lastSequence ?? 0) + 1, scenarioId: input.scenarioId ?? attempt.currentScenarioId, ...(input.startedAt ? { startedAt: input.startedAt } : {}), ...(input.endedAt ? { endedAt: input.endedAt } : {}) }).returning()
      return turn!
    })
  }

  async function recordEvent(input: { organizationId: string; attemptId: string; type: string; payload?: Record<string, unknown>; idempotencyKey?: string }) {
    const [event] = await db.insert(attemptEvents).values({ organizationId: input.organizationId, attemptId: input.attemptId, type: input.type, payload: input.payload ?? {}, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }).onConflictDoNothing().returning()
    return event
  }

  async function completeScenario(input: { organizationId: string; attemptId: string }) {
    return db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, input.organizationId))).for('update').limit(1)
      if (!attempt || attempt.status !== 'IN_PROGRESS' || !attempt.currentScenarioId) throw new ConflictError('ATTEMPT_NOT_ACTIVE', 'Attempt is not active')
      const now = new Date()
      await tx.update(attemptScenarios).set({ completedAt: now }).where(and(eq(attemptScenarios.attemptId, attempt.id), eq(attemptScenarios.scenarioId, attempt.currentScenarioId)))
      const [next] = await tx.select({ scenarioId: attemptScenarios.scenarioId }).from(attemptScenarios).where(and(eq(attemptScenarios.attemptId, attempt.id), isNull(attemptScenarios.completedAt))).orderBy(asc(attemptScenarios.position)).limit(1)
      await tx.update(attempts).set({ currentScenarioId: next?.scenarioId ?? null, lastHeartbeatAt: now, updatedAt: now }).where(eq(attempts.id, attempt.id))
      await tx.insert(attemptEvents).values({ organizationId: input.organizationId, attemptId: attempt.id, type: 'SCENARIO_COMPLETED', payload: { scenarioId: attempt.currentScenarioId } })
      return { completedScenarioId: attempt.currentScenarioId, nextScenarioId: next?.scenarioId ?? null }
    })
  }

  async function completeAssessment(input: { organizationId: string; attemptId: string }) {
    return db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(attempts).where(and(eq(attempts.id, input.attemptId), eq(attempts.organizationId, input.organizationId))).for('update').limit(1)
      if (!attempt || attempt.status !== 'IN_PROGRESS') throw new ConflictError('ATTEMPT_NOT_ACTIVE', 'Attempt is not active')
      const [remainingRow] = await tx.select({ remaining: count() }).from(attemptScenarios).where(and(eq(attemptScenarios.attemptId, attempt.id), isNull(attemptScenarios.completedAt)))
      const remaining = remainingRow?.remaining ?? 0
      if (remaining > 0) throw new ConflictError('SCENARIOS_INCOMPLETE', 'Complete every scenario first')
      const now = new Date()
      await tx.update(attempts).set({ status: 'PROCESSING', currentScenarioId: null, updatedAt: now }).where(eq(attempts.id, attempt.id))
      await tx.update(assignments).set({ status: 'COMPLETED', updatedAt: now }).where(eq(assignments.id, attempt.assignmentId))
      await tx.insert(evaluations).values({ organizationId: input.organizationId, attemptId: attempt.id, status: 'PENDING' }).onConflictDoNothing()
      await tx.insert(attemptEvents).values({ organizationId: input.organizationId, attemptId: attempt.id, type: 'ASSESSMENT_COMPLETED', payload: {}, idempotencyKey: 'assessment-completed' }).onConflictDoNothing()
      return { status: 'PROCESSING' as const }
    })
  }

  async function abandonByEmployee(input: { organizationId: string; attemptId: string; userId: string }) {
    return db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(attempts).where(and(
        eq(attempts.id, input.attemptId),
        eq(attempts.organizationId, input.organizationId),
      )).for('update').limit(1)
      if (!attempt) throw new NotFoundError('Attempt')
      if (attempt.employeeUserId !== input.userId) throw new ForbiddenError()
      if (attempt.status === 'ABANDONED') return { status: attempt.status, roomName: attempt.roomName }
      if (!canTransitionAttempt(attempt.status, 'ABANDONED')) throw new ConflictError('ATTEMPT_NOT_ACTIVE', 'Attempt is not active')

      const now = new Date()
      await tx.update(attempts).set({ status: 'ABANDONED', updatedAt: now }).where(eq(attempts.id, attempt.id))
      await tx.insert(attemptEvents).values({
        organizationId: input.organizationId,
        attemptId: attempt.id,
        type: 'SESSION_ENDED_BY_EMPLOYEE',
        payload: {},
        idempotencyKey: 'employee-ended',
      }).onConflictDoNothing()
      return { status: 'ABANDONED' as const, roomName: attempt.roomName }
    })
  }

  async function getContext(organizationId: string, attemptId: string) {
    const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.organizationId, organizationId))).limit(1)
    if (!attempt) throw new NotFoundError('Attempt')
    const version = await db.select().from(assessmentVersions).where(and(eq(assessmentVersions.id, attempt.assessmentVersionId), eq(assessmentVersions.organizationId, organizationId))).limit(1)
    const ordered = await db.select().from(scenarios).where(and(eq(scenarios.assessmentVersionId, attempt.assessmentVersionId), eq(scenarios.organizationId, organizationId))).orderBy(asc(scenarios.position))
    return { attempt, assessment: version[0]!, scenarios: ordered }
  }

  async function inspectActive(organizationId: string) {
    return db.select({ attemptId: attempts.id, status: attempts.status, roomName: attempts.roomName, currentScenarioId: attempts.currentScenarioId, lastHeartbeatAt: attempts.lastHeartbeatAt, employeeUserId: attempts.employeeUserId, employeeName: users.name, employeeEmail: users.email, assessmentId: attempts.assessmentId }).from(attempts).innerJoin(users, eq(attempts.employeeUserId, users.id)).where(and(eq(attempts.organizationId, organizationId), inArray(attempts.status, ['IN_PROGRESS', 'PROCESSING']))).orderBy(asc(attempts.startedAt))
  }

  async function inspect(organizationId: string, attemptId: string) {
    const context = await getContext(organizationId, attemptId)
    const [turns, events, progress] = await Promise.all([
      db.select().from(attemptTurns).where(and(eq(attemptTurns.organizationId, organizationId), eq(attemptTurns.attemptId, attemptId))).orderBy(asc(attemptTurns.sequence)),
      db.select().from(attemptEvents).where(and(eq(attemptEvents.organizationId, organizationId), eq(attemptEvents.attemptId, attemptId))).orderBy(asc(attemptEvents.createdAt)),
      db.select().from(attemptScenarios).where(and(eq(attemptScenarios.organizationId, organizationId), eq(attemptScenarios.attemptId, attemptId))).orderBy(asc(attemptScenarios.position)),
    ])
    return { ...context, turns, events, progress }
  }

  async function abandonByRoom(roomName: string, eventId: string) {
    const [attempt] = await db.select().from(attempts).where(eq(attempts.roomName, roomName)).limit(1)
    if (!attempt || attempt.status !== 'IN_PROGRESS') return
    await transition({ organizationId: attempt.organizationId, attemptId: attempt.id, to: 'ABANDONED', eventType: 'SESSION_DISCONNECTED', idempotencyKey: eventId })
  }

  return { listForEmployee, prepare, start, failStart, transition, appendTurn, recordEvent, completeScenario, completeAssessment, abandonByEmployee, getContext, inspectActive, inspect, abandonByRoom }
}

function inArrayValue<T>(value: T, choices: readonly T[]): boolean { return choices.includes(value) }
export type AttemptService = ReturnType<typeof createAttemptService>
