import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import type { AppConfig } from '../../../config/index.js'
import { ConfigurationError } from '../../../http/errors.js'
import { rubricCriteriaSchema, type GeneratedAssessmentContent } from '../types/index.js'

const generatedContentSchema = z.object({
  competencies: z.array(z.object({ name: z.string().trim().min(1), description: z.string().trim().min(1) })).min(1).max(12),
  scenarios: z.array(z.object({
    title: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    followUpGuidance: z.string().trim().min(1),
    competencyNames: z.array(z.string().trim().min(1)).min(1),
  })).min(1).max(10),
  rubrics: z.array(z.object({
    competencyName: z.string().trim().min(1),
    title: z.string().trim().min(1),
    criteria: rubricCriteriaSchema,
    expectedBehaviors: z.array(z.string().trim().min(1)).min(1),
  })).min(1).max(12),
})

export type AssessmentGenerator = ReturnType<typeof createAssessmentGenerator>

export function createAssessmentGenerator(config: Pick<AppConfig, 'geminiApiKey' | 'geminiModel'>) {
  const client = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : undefined

  async function generate(input: { assessmentName: string; brief: string; sourceText?: string }): Promise<GeneratedAssessmentContent> {
    if (!client) throw new ConfigurationError('Gemini assessment generation')
    const source = input.sourceText ? `\nSource material:\n${input.sourceText.slice(0, 100_000)}` : ''
    const response = await client.models.generateContent({
      model: config.geminiModel,
      contents: `Create a practical employee AI-skill assessment titled "${input.assessmentName}".\nBrief:\n${input.brief}${source}\nUse fixed workplace scenarios. Every scenario must reference competency names exactly. Create one rubric per competency with distinct 1-5 score descriptions. Do not include markdown.`,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          required: ['competencies', 'scenarios', 'rubrics'],
          properties: {
            competencies: { type: 'array', items: { type: 'object', required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string' } } } },
            scenarios: { type: 'array', items: { type: 'object', required: ['title', 'prompt', 'followUpGuidance', 'competencyNames'], properties: { title: { type: 'string' }, prompt: { type: 'string' }, followUpGuidance: { type: 'string' }, competencyNames: { type: 'array', items: { type: 'string' } } } } },
            rubrics: { type: 'array', items: { type: 'object', required: ['competencyName', 'title', 'criteria', 'expectedBehaviors'], properties: { competencyName: { type: 'string' }, title: { type: 'string' }, criteria: { type: 'array', items: { type: 'object', required: ['score', 'description'], properties: { score: { type: 'integer' }, description: { type: 'string' } } } }, expectedBehaviors: { type: 'array', items: { type: 'string' } } } } },
          },
        },
      },
    })
    if (!response.text) throw new Error('Gemini returned an empty assessment')
    return generatedContentSchema.parse(JSON.parse(response.text))
  }

  return { generate }
}
