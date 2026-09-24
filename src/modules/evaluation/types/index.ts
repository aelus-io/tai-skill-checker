import { z } from 'zod'

const nonEmptyText = z.string().trim().min(1).max(4_000)

export const evaluationResponseSchema = z.object({
  overallScore: z.number().min(1).max(5),
  competencies: z.array(z.object({
    competencyId: z.uuid(),
    score: z.number().int().min(1).max(5),
    reasoning: nonEmptyText,
    evidence: z.array(z.object({
      turnId: z.uuid(),
      reason: nonEmptyText,
    }).strict()).min(1),
  }).strict()).min(1),
  strengths: z.array(nonEmptyText).min(1),
  gaps: z.array(nonEmptyText).min(1),
  recommendations: z.array(nonEmptyText).min(1),
}).strict()

export type EvaluationResponse = z.infer<typeof evaluationResponseSchema>

export type EvaluationInput = {
  attemptId: string
  organizationId: string
  assessment: { id: string; versionId: string; versionNumber: number; name: string; description: string; preparationInstructions: string }
  competencies: Array<{
    id: string
    name: string
    description: string
    position: number
    rubric: { title: string; criteria: Array<{ score: number; description: string }>; expectedBehaviors: string[] }
    scenarios: Array<{ id: string; title: string; prompt: string; followUpGuidance: string }>
  }>
  transcript: Array<{ id: string; scenarioId: string | null; speaker: 'EMPLOYEE' | 'AGENT' | 'SYSTEM'; sequence: number; content: string }>
  resources: Array<{ resourceId: string; filename: string; position: number; content: string }>
}

export type ClaimedEvaluation = { id: string; organizationId: string; attemptId: string; claimToken: string }

export type EvaluationModel = {
  evaluate(input: EvaluationInput): Promise<unknown>
}
