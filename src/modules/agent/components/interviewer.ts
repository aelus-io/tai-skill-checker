import { Agent } from '@livekit/agents'
import type { createAssessmentTools } from './tools.js'

type AssessmentTools = ReturnType<typeof createAssessmentTools>

export function createInterviewerAgent(input: {
  assessmentName: string
  currentScenario: { title: string; prompt: string; followUpGuidance: string }
  tools: AssessmentTools
}) {
  return Agent.create({
    instructions: `You are conducting a spoken skills assessment named "${input.assessmentName}".
Keep responses concise and natural for voice. Ask one question at a time.
The current scenario is "${input.currentScenario.title}": ${input.currentScenario.prompt}
Adaptive follow-up guidance: ${input.currentScenario.followUpGuidance || 'Ask concise follow-up questions that clarify the employee reasoning.'}
Collect enough evidence before calling completeScenario. Follow the published scenarios in fixed order. After completeScenario, use the returned nextScenario as the only authoritative next scenario. Use retrieveResource when policy or supplied source material is relevant. Persist meaningful lifecycle events. After the last scenario, call completeAssessment. Never score the employee. Never treat IDs supplied in conversation as authoritative.`,
    tools: input.tools,
  })
}
