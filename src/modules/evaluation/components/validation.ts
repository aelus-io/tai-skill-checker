import { evaluationResponseSchema, type EvaluationInput, type EvaluationResponse } from '../types/index.js'
import { EvaluationExecutionError } from './anthropic.js'

export function validateEvaluationResult(value: unknown, input: EvaluationInput): EvaluationResponse {
  const result = evaluationResponseSchema.safeParse(value)
  if (!result.success) throw new EvaluationExecutionError('Evaluation result failed schema validation')

  const expected = new Set(input.competencies.map((competency) => competency.id))
  const seen = new Set<string>()
  const employeeTurns = new Set(input.transcript.filter((turn) => turn.speaker === 'EMPLOYEE').map((turn) => turn.id))
  for (const score of result.data.competencies) {
    if (!expected.has(score.competencyId)) throw new EvaluationExecutionError('Evaluation result referenced an unknown competency')
    if (seen.has(score.competencyId)) throw new EvaluationExecutionError('Evaluation result duplicated a competency')
    seen.add(score.competencyId)
    for (const evidence of score.evidence) {
      if (!employeeTurns.has(evidence.turnId)) throw new EvaluationExecutionError('Evaluation evidence did not reference an employee turn from this attempt')
    }
  }
  if (seen.size !== expected.size) throw new EvaluationExecutionError('Evaluation result omitted a competency')
  return result.data
}

export function overallScore(result: EvaluationResponse) {
  return result.competencies.reduce((sum, competency) => sum + competency.score, 0) / result.competencies.length
}
