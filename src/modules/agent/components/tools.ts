import { llm } from '@livekit/agents'
import { z } from 'zod'
import type { AttemptService } from '../../attempts/index.js'
import type { ResourceService } from '../../resources/index.js'

export function createAssessmentTools(context: { organizationId: string; assessmentId: string; assessmentVersionId: string; attemptId: string }, attempts: AttemptService, resources: ResourceService, onComplete: () => void) {
  let lifecycleQueue = Promise.resolve()
  const serializeLifecycle = <T>(operation: () => Promise<T>) => {
    const result = lifecycleQueue.then(operation, operation)
    lifecycleQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    getAssessmentContext: llm.tool({ description: 'Get the authoritative assessment and ordered scenario context.', parameters: z.object({}), execute: async () => attempts.getContext(context.organizationId, context.attemptId) }),
    getCurrentScenario: llm.tool({ description: 'Get the authoritative current scenario.', parameters: z.object({}), execute: async () => { const value = await attempts.getContext(context.organizationId, context.attemptId); return value.scenarios.find((item) => item.id === value.attempt.currentScenarioId) ?? null } }),
    retrieveResource: llm.tool({ description: 'Retrieve relevant passages from the exact published assessment version.', parameters: z.object({ query: z.string().min(2).max(500) }), execute: async ({ query }) => resources.retrieve({ organizationId: context.organizationId, assessmentId: context.assessmentId, assessmentVersionId: context.assessmentVersionId, query }) }),
    recordAssessmentEvent: llm.tool({ description: 'Record a lifecycle or interview event. Trusted attempt identity is supplied by the backend.', parameters: z.object({ type: z.string().min(1).max(100), details: z.record(z.string(), z.unknown()).default({}) }), execute: async ({ type, details }) => { await attempts.recordEvent({ organizationId: context.organizationId, attemptId: context.attemptId, type: `AGENT_${type}`, payload: details }); return { recorded: true } } }),
    completeScenario: llm.tool({ description: 'Mark the current scenario complete and return the authoritative next scenario in fixed order. When this is the final scenario, the backend automatically completes the assessment and starts evaluation.', parameters: z.object({}), execute: (_parameters, toolContext) => serializeLifecycle(async () => {
      toolContext.ctx.disallowInterruptions()
      const result = await attempts.completeScenario({ organizationId: context.organizationId, attemptId: context.attemptId })
      const value = await attempts.getContext(context.organizationId, context.attemptId)
      const nextScenario = value.scenarios.find((item) => item.id === result.nextScenarioId) ?? null
      if (nextScenario) return { ...result, nextScenario, assessmentStatus: 'IN_PROGRESS' as const }
      const assessment = await attempts.completeAssessment({ organizationId: context.organizationId, attemptId: context.attemptId })
      onComplete()
      return { ...result, nextScenario: null, assessmentStatus: assessment.status }
    }) }),
    completeAssessment: llm.tool({ description: 'Recovery-only completion tool. Normally the final completeScenario call automatically completes the assessment and starts evaluation.', parameters: z.object({}), execute: (_parameters, toolContext) => serializeLifecycle(async () => {
      toolContext.ctx.disallowInterruptions()
      const value = await attempts.getContext(context.organizationId, context.attemptId)
      if (value.attempt.status === 'PROCESSING') return { status: 'PROCESSING' as const }
      const currentScenario = value.scenarios.find((item) => item.id === value.attempt.currentScenarioId) ?? null
      if (currentScenario) return { status: 'SCENARIOS_INCOMPLETE' as const, currentScenario, nextAction: 'Finish the current scenario, then call completeScenario.' }
      const result = await attempts.completeAssessment({ organizationId: context.organizationId, attemptId: context.attemptId })
      onComplete()
      return result
    }) }),
  }
}
