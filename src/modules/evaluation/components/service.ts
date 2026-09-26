import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import {
  assessments, assessmentVersions, attempts, attemptEvents, attemptTurns, competencies, competencyScores,
  evaluationEvidence, evaluations, resourceChunks, resources, rubrics, scenarioCompetencies, scenarios, users,
} from '../../../db/schema.js'
import { NotFoundError } from '../../../http/errors.js'
import type { ClaimedEvaluation, EvaluationInput, EvaluationModel } from '../types/index.js'
import { EvaluationExecutionError } from './anthropic.js'
import { overallScore, validateEvaluationResult } from './validation.js'
import { assertActiveClaim, assertRetryableEvaluation, staleClaimCutoff } from './lifecycle.js'

const transcriptSettleMs = 3_000

export function createEvaluationService(db: Database, model: EvaluationModel) {
  async function claimNext(now = new Date()): Promise<ClaimedEvaluation | null> {
    return db.transaction(async (tx) => {
      // Backfill valid submissions created before the evaluator worker was deployed.
      await tx.execute(sql`insert into evaluations (organization_id, attempt_id, status)
        select a.organization_id, a.id, 'PENDING'::evaluation_status from attempts a
        where a.status = 'PROCESSING'::attempt_status
          and exists (select 1 from attempt_events e where e.attempt_id = a.id and e.type = 'ASSESSMENT_COMPLETED')
        on conflict (attempt_id) do nothing`)
      await tx.update(evaluations).set({
        status: 'PENDING', claimToken: null, claimedAt: null,
        errorMessage: 'Evaluation claim expired and was recovered', updatedAt: now,
      }).where(and(eq(evaluations.status, 'PROCESSING'), lt(evaluations.claimedAt, staleClaimCutoff(now))))

      const [candidate] = await tx.select({
        id: evaluations.id, organizationId: evaluations.organizationId, attemptId: evaluations.attemptId,
      }).from(evaluations).innerJoin(attempts, and(
        eq(attempts.id, evaluations.attemptId), eq(attempts.organizationId, evaluations.organizationId),
      )).where(and(eq(evaluations.status, 'PENDING'), eq(attempts.status, 'PROCESSING'), lt(evaluations.createdAt, new Date(now.getTime() - transcriptSettleMs))))
        .orderBy(asc(evaluations.createdAt)).for('update', { skipLocked: true }).limit(1)
      if (!candidate) return null
      const claimToken = randomUUID()
      const [claimed] = await tx.update(evaluations).set({
        status: 'PROCESSING', claimedAt: now, claimToken,
        attemptCount: sql`${evaluations.attemptCount} + 1`, errorMessage: null, updatedAt: now,
      }).where(and(eq(evaluations.id, candidate.id), eq(evaluations.status, 'PENDING'))).returning({ id: evaluations.id })
      return claimed ? { ...candidate, claimToken } : null
    })
  }

  async function loadInput(claim: ClaimedEvaluation): Promise<EvaluationInput> {
    const [context] = await db.select({
      attemptId: attempts.id, organizationId: attempts.organizationId, assessmentId: attempts.assessmentId,
      versionId: assessmentVersions.id, versionNumber: assessmentVersions.versionNumber, name: assessments.name,
      description: assessmentVersions.description, preparationInstructions: assessmentVersions.preparationInstructions,
    }).from(attempts).innerJoin(assessmentVersions, and(
      eq(assessmentVersions.id, attempts.assessmentVersionId), eq(assessmentVersions.organizationId, attempts.organizationId),
    )).innerJoin(assessments, and(
      eq(assessments.id, attempts.assessmentId), eq(assessments.organizationId, attempts.organizationId),
    )).where(and(eq(attempts.id, claim.attemptId), eq(attempts.organizationId, claim.organizationId), eq(attempts.status, 'PROCESSING'))).limit(1)
    if (!context) throw new EvaluationExecutionError('Evaluation input is unavailable')

    const [competencyRows, rubricRows, scenarioRows, mappings, transcript, chunks] = await Promise.all([
      db.select().from(competencies).where(and(eq(competencies.organizationId, claim.organizationId), eq(competencies.assessmentVersionId, context.versionId))).orderBy(asc(competencies.position)),
      db.select().from(rubrics).where(and(eq(rubrics.organizationId, claim.organizationId), eq(rubrics.assessmentVersionId, context.versionId))),
      db.select().from(scenarios).where(and(eq(scenarios.organizationId, claim.organizationId), eq(scenarios.assessmentVersionId, context.versionId))).orderBy(asc(scenarios.position)),
      db.select().from(scenarioCompetencies).where(and(eq(scenarioCompetencies.organizationId, claim.organizationId), eq(scenarioCompetencies.assessmentVersionId, context.versionId))),
      db.select({ id: attemptTurns.id, scenarioId: attemptTurns.scenarioId, speaker: attemptTurns.speaker, sequence: attemptTurns.sequence, content: attemptTurns.content }).from(attemptTurns).where(and(eq(attemptTurns.organizationId, claim.organizationId), eq(attemptTurns.attemptId, claim.attemptId))).orderBy(asc(attemptTurns.sequence)),
      db.select({ resourceId: resourceChunks.resourceId, filename: resources.filename, position: resourceChunks.position, content: resourceChunks.content }).from(resourceChunks).innerJoin(resources, and(eq(resources.id, resourceChunks.resourceId), eq(resources.organizationId, resourceChunks.organizationId))).where(and(eq(resourceChunks.organizationId, claim.organizationId), eq(resourceChunks.assessmentVersionId, context.versionId))).orderBy(asc(resourceChunks.resourceId), asc(resourceChunks.position)),
    ])
    const inputCompetencies = competencyRows.map((competency) => {
      const rubric = rubricRows.find((item) => item.competencyId === competency.id)
      if (!rubric) throw new EvaluationExecutionError('Published evaluation criteria are incomplete')
      const scenarioIds = new Set(mappings.filter((item) => item.competencyId === competency.id).map((item) => item.scenarioId))
      return {
        id: competency.id, name: competency.name, description: competency.description, position: competency.position,
        rubric: { title: rubric.title, criteria: rubric.criteria, expectedBehaviors: rubric.expectedBehaviors },
        scenarios: scenarioRows.filter((scenario) => scenarioIds.has(scenario.id)).map(({ id, title, prompt, followUpGuidance }) => ({ id, title, prompt, followUpGuidance })),
      }
    })
    if (!inputCompetencies.length || !transcript.some((turn) => turn.speaker === 'EMPLOYEE')) throw new EvaluationExecutionError('Evaluation input is incomplete')
    return {
      attemptId: context.attemptId, organizationId: context.organizationId,
      assessment: { id: context.assessmentId, versionId: context.versionId, versionNumber: context.versionNumber, name: context.name, description: context.description, preparationInstructions: context.preparationInstructions },
      competencies: inputCompetencies, transcript, resources: chunks,
    }
  }

  async function complete(claim: ClaimedEvaluation, input: EvaluationInput, value: unknown) {
    const result = validateEvaluationResult(value, input)
    const computedOverall = overallScore(result)
    await db.transaction(async (tx) => {
      const [evaluation] = await tx.select().from(evaluations).where(and(
        eq(evaluations.id, claim.id), eq(evaluations.organizationId, claim.organizationId),
        eq(evaluations.status, 'PROCESSING'), eq(evaluations.claimToken, claim.claimToken),
      )).for('update').limit(1)
      assertActiveClaim(evaluation, claim)
      await tx.delete(competencyScores).where(eq(competencyScores.evaluationId, evaluation.id))
      for (const item of result.competencies) {
        const [score] = await tx.insert(competencyScores).values({ organizationId: claim.organizationId, evaluationId: evaluation.id, competencyId: item.competencyId, score: item.score, maxScore: 5, reasoning: item.reasoning }).returning({ id: competencyScores.id })
        if (!score) throw new EvaluationExecutionError('Evaluation score could not be persisted')
        await tx.insert(evaluationEvidence).values(item.evidence.map((evidence) => ({ organizationId: claim.organizationId, competencyScoreId: score.id, attemptTurnId: evidence.turnId, reason: evidence.reason })))
      }
      const now = new Date()
      await tx.update(evaluations).set({ status: 'COMPLETED', overallScore: computedOverall, strengths: result.strengths, gaps: result.gaps, recommendations: result.recommendations, errorMessage: null, claimToken: null, claimedAt: null, updatedAt: now }).where(eq(evaluations.id, evaluation.id))
      const [attempt] = await tx.update(attempts).set({ status: 'COMPLETED', completedAt: now, updatedAt: now }).where(and(eq(attempts.id, claim.attemptId), eq(attempts.organizationId, claim.organizationId), eq(attempts.status, 'PROCESSING'))).returning({ id: attempts.id })
      if (!attempt) throw new EvaluationExecutionError('Attempt could not transition to completed')
      await tx.insert(attemptEvents).values({ organizationId: claim.organizationId, attemptId: claim.attemptId, type: 'EVALUATION_COMPLETED', payload: { evaluationId: evaluation.id }, idempotencyKey: 'evaluation-completed' }).onConflictDoNothing()
    })
  }

  async function fail(claim: ClaimedEvaluation, error: unknown) {
    const message = error instanceof EvaluationExecutionError ? error.safeMessage : 'Evaluation failed unexpectedly'
    await db.update(evaluations).set({ status: 'FAILED', errorMessage: message, claimToken: null, claimedAt: null, updatedAt: new Date() }).where(and(
      eq(evaluations.id, claim.id), eq(evaluations.organizationId, claim.organizationId), eq(evaluations.status, 'PROCESSING'), eq(evaluations.claimToken, claim.claimToken),
    ))
  }

  async function execute(claim: ClaimedEvaluation) {
    try {
      const input = await loadInput(claim)
      const result = await model.evaluate(input)
      await complete(claim, input, result)
    } catch (error) {
      await fail(claim, error)
    }
  }

  async function retry(organizationId: string, evaluationId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select({ id: evaluations.id, attemptStatus: attempts.status }).from(evaluations).innerJoin(attempts, and(eq(attempts.id, evaluations.attemptId), eq(attempts.organizationId, evaluations.organizationId))).where(and(eq(evaluations.id, evaluationId), eq(evaluations.organizationId, organizationId))).for('update').limit(1)
      if (!row) throw new NotFoundError('Evaluation')
      const [evaluation] = await tx.select().from(evaluations).where(eq(evaluations.id, evaluationId)).limit(1)
      assertRetryableEvaluation(evaluation?.status ?? 'MISSING', row.attemptStatus)
      const [updated] = await tx.update(evaluations).set({ status: 'PENDING', errorMessage: null, claimedAt: null, claimToken: null, updatedAt: new Date() }).where(eq(evaluations.id, evaluationId)).returning()
      return updated!
    })
  }

  async function list(organizationId: string, filters: { status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | undefined; assessmentId?: string | undefined }) {
    return db.select({
      id: evaluations.id, attemptId: evaluations.attemptId, status: evaluations.status, overallScore: evaluations.overallScore,
      employeeName: users.name, employeeEmail: users.email, assessmentId: assessments.id, assessmentName: assessments.name,
      versionNumber: assessmentVersions.versionNumber, completedAt: attempts.completedAt, updatedAt: evaluations.updatedAt,
    }).from(evaluations)
      .innerJoin(attempts, and(eq(attempts.id, evaluations.attemptId), eq(attempts.organizationId, evaluations.organizationId)))
      .innerJoin(users, eq(users.id, attempts.employeeUserId))
      .innerJoin(assessmentVersions, and(eq(assessmentVersions.id, attempts.assessmentVersionId), eq(assessmentVersions.organizationId, evaluations.organizationId)))
      .innerJoin(assessments, and(eq(assessments.id, attempts.assessmentId), eq(assessments.organizationId, evaluations.organizationId)))
      .where(and(eq(evaluations.organizationId, organizationId), filters.status ? eq(evaluations.status, filters.status) : undefined, filters.assessmentId ? eq(attempts.assessmentId, filters.assessmentId) : undefined))
      .orderBy(sql`${evaluations.updatedAt} desc`)
  }

  async function getForAttempt(organizationId: string, attemptId: string) {
    const [evaluation] = await db.select().from(evaluations).where(and(eq(evaluations.organizationId, organizationId), eq(evaluations.attemptId, attemptId))).limit(1)
    if (!evaluation) return null
    const scores = await db.select({ id: competencyScores.id, competencyId: competencyScores.competencyId, competencyName: competencies.name, score: competencyScores.score, maxScore: competencyScores.maxScore, reasoning: competencyScores.reasoning }).from(competencyScores).innerJoin(competencies, and(eq(competencies.id, competencyScores.competencyId), eq(competencies.organizationId, organizationId))).where(and(eq(competencyScores.organizationId, organizationId), eq(competencyScores.evaluationId, evaluation.id))).orderBy(asc(competencies.position))
    const evidence = scores.length ? await db.select().from(evaluationEvidence).where(and(eq(evaluationEvidence.organizationId, organizationId), inArray(evaluationEvidence.competencyScoreId, scores.map((score) => score.id)))) : []
    return { ...evaluation, maxScore: 5, competencyScores: scores.map((score) => ({ ...score, evidence: evidence.filter((item) => item.competencyScoreId === score.id) })) }
  }

  return { claimNext, execute, retry, list, getForAttempt }
}

export type EvaluationService = ReturnType<typeof createEvaluationService>
