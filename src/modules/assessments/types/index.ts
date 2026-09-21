import { z } from 'zod'

export const rubricCriteriaSchema = z.array(z.object({
  score: z.number().int().min(1).max(5),
  description: z.string().trim().min(1).max(2_000),
})).min(2).refine((criteria) => new Set(criteria.map((item) => item.score)).size === criteria.length, {
  message: 'Rubric scores must be unique',
})

export type RubricCriteria = z.infer<typeof rubricCriteriaSchema>

export type GeneratedAssessmentContent = {
  scenarios: Array<{ title: string; prompt: string; followUpGuidance: string; competencyNames: string[] }>
  competencies: Array<{ name: string; description: string }>
  rubrics: Array<{ competencyName: string; title: string; criteria: RubricCriteria; expectedBehaviors: string[] }>
}
