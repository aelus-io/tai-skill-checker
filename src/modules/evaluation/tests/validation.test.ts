import { describe, expect, it } from 'vitest'
import { evaluationResponseSchema, overallScore, validateEvaluationResult, type EvaluationInput } from '../index.js'

const employeeTurnId = '00000000-0000-4000-8000-000000000011'
const agentTurnId = '00000000-0000-4000-8000-000000000012'
const competencyIds = ['00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000022']
const input: EvaluationInput = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  assessment: { id: '00000000-0000-4000-8000-000000000003', versionId: '00000000-0000-4000-8000-000000000004', versionNumber: 1, name: 'Assessment', description: 'Description', preparationInstructions: '' },
  competencies: competencyIds.map((id, index) => ({ id, name: `Competency ${index}`, description: 'Description', position: index + 1, rubric: { title: 'Rubric', criteria: [{ score: 1, description: 'Low' }, { score: 3, description: 'Acceptable' }, { score: 5, description: 'Strong' }], expectedBehaviors: ['Explains reasoning'] }, scenarios: [] })),
  transcript: [
    { id: employeeTurnId, scenarioId: null, speaker: 'EMPLOYEE', sequence: 1, content: 'Answer' },
    { id: agentTurnId, scenarioId: null, speaker: 'AGENT', sequence: 2, content: 'Question' },
  ],
  resources: [],
}

function validResult() {
  return {
    overallScore: 5,
    competencies: competencyIds.map((competencyId, index) => ({ competencyId, score: index + 3, reasoning: 'Transcript-backed reasoning', evidence: [{ turnId: employeeTurnId, reason: 'Relevant answer' }] })),
    strengths: ['Clear reasoning'], gaps: ['Could add detail'], recommendations: ['Practice examples'],
  }
}

describe('evaluation validation', () => {
  it('requires strict integer 1-5 scores and non-empty evidence and summaries', () => {
    expect(evaluationResponseSchema.safeParse(validResult()).success).toBe(true)
    expect(evaluationResponseSchema.safeParse({ ...validResult(), competencies: [{ ...validResult().competencies[0], score: 2.5 }] }).success).toBe(false)
    expect(evaluationResponseSchema.safeParse({ ...validResult(), competencies: [{ ...validResult().competencies[0], score: 6 }] }).success).toBe(false)
    expect(evaluationResponseSchema.safeParse({ ...validResult(), strengths: [] }).success).toBe(false)
  })

  it('requires every expected competency exactly once', () => {
    expect(() => validateEvaluationResult({ ...validResult(), competencies: [validResult().competencies[0]] }, input)).toThrow(/omitted/)
    expect(() => validateEvaluationResult({ ...validResult(), competencies: [validResult().competencies[0], validResult().competencies[0]] }, input)).toThrow(/duplicated/)
    expect(() => validateEvaluationResult({ ...validResult(), competencies: [{ ...validResult().competencies[0], competencyId: '00000000-0000-4000-8000-000000000099' }, validResult().competencies[1]] }, input)).toThrow(/unknown competency/)
  })

  it('rejects unknown and non-employee evidence turns', () => {
    expect(() => validateEvaluationResult({ ...validResult(), competencies: [{ ...validResult().competencies[0], evidence: [{ turnId: agentTurnId, reason: 'Not employee evidence' }] }, validResult().competencies[1]] }, input)).toThrow(/employee turn/)
    expect(() => validateEvaluationResult({ ...validResult(), competencies: [{ ...validResult().competencies[0], evidence: [{ turnId: '00000000-0000-4000-8000-000000000099', reason: 'Unknown' }] }, validResult().competencies[1]] }, input)).toThrow(/employee turn/)
  })

  it('computes the unweighted overall score without trusting provider arithmetic', () => {
    const result = validateEvaluationResult(validResult(), input)
    expect(result.overallScore).toBe(5)
    expect(overallScore(result)).toBe(3.5)
  })
})
