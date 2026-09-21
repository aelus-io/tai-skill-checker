import { llm } from '@livekit/agents'
import { z } from 'zod'
import type { AttemptService } from '../../attempts/index.js'
import type { ResourceService } from '../../resources/index.js'

export function createAssessmentTools(context: { organizationId: string; assessmentId: string; assessmentVersionId: string; attemptId: string }, attempts: AttemptService, resources: ResourceService, onComplete: () => void) {
  return {
    getAssessmentContext: llm.tool({ description: 'Get the authoritative assessment and ordered scenario context.', parameters: z.object({}), execute: async () => attempts.getContext(context.organizationId, context.attemptId) }),
    getCurrentScenario: llm.tool({ description: 'Get the authoritative current scenario.', parameters: z.object({}), execute: async () => { const value = await attempts.getContext(context.organizationId, context.attemptId); return value.scenarios.find((item) => item.id === value.attempt.currentScenarioId) ?? null } }),
    retrieveResource: llm.tool({ description: 'Retrieve relevant passages from the exact published assessment version.', parameters: z.object({ query: z.string().min(2).max(500) }), execute: async ({ query }) => resources.retrieve({ organizationId: context.organizationId, assessmentId: context.assessmentId, assessmentVersionId: context.assessmentVersionId, query }) }),
    recordAssessmentEvent: llm.tool({ description: 'Record a lifecycle or interview event. Trusted attempt identity is supplied by the backend.', parameters: z.object({ type: z.string().min(1).max(100), details: z.record(z.string(), z.unknown()).default({}) }), execute: async ({ type, details }) => { await attempts.recordEvent({ organizationId: context.organizationId, attemptId: context.attemptId, type: `AGENT_${type}`, payload: details }); return { recorded: true } } }),
    completeScenario: llm.tool({ description: 'Mark the current scenario complete and return the authoritative next scenario in fixed order.', parameters: z.object({}), execute: async () => {
      const result = await attempts.completeScenario({ organizationId: context.organizationId, attemptId: context.attemptId })
      const value = await attempts.getContext(context.organizationId, context.attemptId)
      return { ...result, nextScenario: value.scenarios.find((item) => item.id === result.nextScenarioId) ?? null }
    } }),
    completeAssessment: llm.tool({ description: 'Complete the assessment after every scenario is complete.', parameters: z.object({}), execute: async () => { const result = await attempts.completeAssessment({ organizationId: context.organizationId, attemptId: context.attemptId }); onComplete(); return result } }),
  }
}
