import { AgentSession, initializeLogger, voice } from '@livekit/agents'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttemptService } from '../../attempts/index.js'
import type { ResourceService } from '../../resources/index.js'
import { createAssessmentTools, createInterviewerAgent } from '../index.js'

initializeLogger({ pretty: false, level: 'warn' })

const trusted = { organizationId: 'org-1', assessmentId: 'assessment-1', assessmentVersionId: 'version-1', attemptId: 'attempt-1' }

function dependencies() {
  const getContext = vi.fn().mockResolvedValue({
    attempt: { id: trusted.attemptId, currentScenarioId: 'scenario-2' },
    assessment: { name: 'AI Safety' },
    scenarios: [
      { id: 'scenario-1', title: 'First', prompt: 'First prompt', followUpGuidance: '', position: 1 },
      { id: 'scenario-2', title: 'Second', prompt: 'Second prompt', followUpGuidance: 'Ask why.', position: 2 },
    ],
  })
  const attempts = {
    getContext,
    completeScenario: vi.fn().mockResolvedValue({ completedScenarioId: 'scenario-1', nextScenarioId: 'scenario-2' }),
    completeAssessment: vi.fn().mockResolvedValue({ status: 'PROCESSING' }),
    recordEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
  } as unknown as AttemptService
  const resources = { retrieve: vi.fn().mockResolvedValue([{ content: 'Policy passage' }]) } as unknown as ResourceService
  return { attempts, resources, getContext }
}

const toolContext = () => ({
  toolCallId: 'call-1',
  abortSignal: new AbortController().signal,
  ctx: { disallowInterruptions: vi.fn() },
}) as never

const sessions: AgentSession[] = []
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.close())) })

describe('assessment interviewer agent', () => {
  it('responds to a basic employee greeting through the LiveKit test framework', async () => {
    const deps = dependencies()
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, () => undefined)
    const agent = createInterviewerAgent({ assessmentName: 'AI Safety', currentScenario: { title: 'Privacy incident', prompt: 'How would you respond?', followUpGuidance: 'Ask for concrete steps.' }, tools })
    const session = new AgentSession({ llm: new voice.testing.FakeLLM([{ input: 'Hello', content: 'Welcome. Let us begin with the privacy incident scenario.' }]), vad: null, turnHandling: { turnDetection: null } })
    sessions.push(session)
    await session.start({ agent })
    const result = await session.run({ userInput: 'Hello' }).wait()
    result.expect.nextEvent().isMessage({ role: 'assistant' })
    result.expect.noMoreEvents()
  })

  it('invokes completeScenario and returns the authoritative next scenario', async () => {
    const deps = dependencies()
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, () => undefined)
    const agent = createInterviewerAgent({ assessmentName: 'AI Safety', currentScenario: { title: 'First', prompt: 'First prompt', followUpGuidance: '' }, tools })
    const session = new AgentSession({ llm: new voice.testing.FakeLLM([{ input: 'I have finished my answer.', toolCalls: [{ name: 'completeScenario', args: {} }] }]), vad: null, turnHandling: { turnDetection: null } })
    sessions.push(session)
    await session.start({ agent })
    const result = await session.run({ userInput: 'I have finished my answer.' }).wait()
    result.expect.nextEvent().isFunctionCall({ name: 'completeScenario', args: {} })
    result.expect.nextEvent().isFunctionCallOutput()
    expect(deps.attempts.completeScenario).toHaveBeenCalledWith({ organizationId: 'org-1', attemptId: 'attempt-1' })
    expect(deps.getContext).toHaveBeenCalledWith('org-1', 'attempt-1')
  })

  it('keeps tenant and attempt identifiers out of model controlled retrieval arguments', async () => {
    const deps = dependencies()
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, () => undefined)
    await tools.retrieveResource.execute({ query: 'privacy policy' }, toolContext())
    expect(deps.resources.retrieve).toHaveBeenCalledWith({ organizationId: trusted.organizationId, assessmentId: trusted.assessmentId, assessmentVersionId: trusted.assessmentVersionId, query: 'privacy policy' })
  })

  it('returns actionable state instead of throwing when assessment completion is premature', async () => {
    const deps = dependencies()
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, () => undefined)

    const result = await tools.completeAssessment.execute({}, toolContext())

    expect(result).toMatchObject({ status: 'SCENARIOS_INCOMPLETE', currentScenario: { id: 'scenario-2' } })
    expect(deps.attempts.completeAssessment).not.toHaveBeenCalled()
  })

  it('automatically completes the assessment after the final scenario', async () => {
    const deps = dependencies()
    let currentScenarioId: string | null = 'scenario-2'
    deps.attempts.completeScenario = vi.fn().mockImplementation(async () => {
      await Promise.resolve()
      currentScenarioId = null
      return { completedScenarioId: 'scenario-2', nextScenarioId: null }
    })
    deps.getContext.mockImplementation(async () => ({
      attempt: { id: trusted.attemptId, currentScenarioId },
      assessment: { name: 'AI Safety' },
      scenarios: [{ id: 'scenario-2', title: 'Second', prompt: 'Second prompt', followUpGuidance: '', position: 2 }],
    }))
    const onComplete = vi.fn()
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, onComplete)

    const result = await tools.completeScenario.execute({}, toolContext())

    expect(result).toMatchObject({ nextScenario: null, assessmentStatus: 'PROCESSING' })
    expect(deps.attempts.completeAssessment).toHaveBeenCalledWith({ organizationId: 'org-1', attemptId: 'attempt-1' })
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('returns a safe tool error when a provider operation fails', async () => {
    const deps = dependencies()
    deps.resources.retrieve.mockRejectedValue(new Error('provider secret must not reach the model'))
    const tools = createAssessmentTools(trusted, deps.attempts, deps.resources, () => undefined)
    const agent = createInterviewerAgent({ assessmentName: 'AI Safety', currentScenario: { title: 'Privacy incident', prompt: 'How would you respond?', followUpGuidance: '' }, tools })
    const session = new AgentSession({ llm: new voice.testing.FakeLLM([{ input: 'Check the policy.', toolCalls: [{ name: 'retrieveResource', args: { query: 'privacy policy' } }] }]), vad: null, turnHandling: { turnDetection: null } })
    sessions.push(session)
    await session.start({ agent })
    const result = await session.run({ userInput: 'Check the policy.' }).wait()
    result.expect.nextEvent().isFunctionCall({ name: 'retrieveResource', args: { query: 'privacy policy' } })
    result.expect.nextEvent().isFunctionCallOutput({ isError: true, output: 'An internal error occurred' })
  })
})
