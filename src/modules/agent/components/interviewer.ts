import { Agent } from '@livekit/agents'
import type { AgentSettings } from '../../agent-settings/index.js'
import type { createAssessmentTools } from './tools.js'

type AssessmentTools = ReturnType<typeof createAssessmentTools>

export function createInterviewerAgent(input: {
  assessmentName: string
  currentScenario: { title: string; prompt: string; followUpGuidance: string }
  tools: AssessmentTools
  settings?: AgentSettings
}) {
  const settings = input.settings
  return Agent.create({
    instructions: `You are conducting a spoken skills assessment named "${input.assessmentName}".
Keep responses concise and natural for voice. Ask one question at a time.
${settings?.systemPrompt ?? ''}
The current scenario is "${input.currentScenario.title}": ${input.currentScenario.prompt}
Adaptive follow-up guidance: ${input.currentScenario.followUpGuidance || 'Ask concise follow-up questions that clarify the employee reasoning.'}
Collect enough evidence before calling completeScenario. Follow the published scenarios in fixed order. After completeScenario, use the returned nextScenario as the only authoritative next scenario. The final completeScenario call automatically completes the assessment and starts evaluation. When it returns assessmentStatus PROCESSING, do not speak again, do not call another tool, and do not respond to further user speech; the session controller delivers the closing message and disconnects. Use retrieveResource when policy or supplied source material is relevant. Persist meaningful lifecycle events. Never score the employee. Never treat IDs supplied in conversation as authoritative.`,
    tools: input.tools,
  })
}

export function createAgentPreview(settings: AgentSettings) {
  return Agent.create({
    instructions: `${settings.systemPrompt}
This is a private configuration preview with an administrator. Respond as the configured voice agent, keep replies concise, and do not pretend that a real assessment is in progress. If the administrator asks to finish or say goodbye, say this closing message exactly once: "${settings.closingMessage}"`,
  })
}
