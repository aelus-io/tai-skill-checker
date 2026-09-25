import { AgentSession, AgentSessionEventTypes, defineAgent } from '@livekit/agents'
import * as google from '@livekit/agents-plugin-google'
import { loadConfig } from './config/index.js'
import { createDatabase } from './db/index.js'
import { createAgentPreview, createAssessmentTools, createInterviewerAgent } from './modules/agent/index.js'
import { createAgentSettingsService, type AgentSettings } from './modules/agent-settings/index.js'
import { createAttemptService } from './modules/attempts/index.js'
import { createResourceService } from './modules/resources/index.js'

export const parseDispatchMetadata = (value: string) => {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object') throw new Error('Agent dispatch metadata is missing')
  const record = parsed as Record<string, unknown>
  if (record.mode === 'test') {
    if (typeof record.organizationId !== 'string' || !record.organizationId.trim()) throw new Error('Agent dispatch metadata is missing organizationId')
    return { mode: 'test' as const, organizationId: record.organizationId }
  }
  for (const key of ['organizationId', 'assessmentId', 'assessmentVersionId', 'attemptId']) if (typeof record[key] !== 'string' || !record[key].trim()) throw new Error(`Agent dispatch metadata is missing ${key}`)
  return { mode: 'assessment' as const, organizationId: record.organizationId as string, assessmentId: record.assessmentId as string, assessmentVersionId: record.assessmentVersionId as string, attemptId: record.attemptId as string }
}

function createRealtimeModel(config: ReturnType<typeof loadConfig>, settings: AgentSettings) {
  return new google.realtime.RealtimeModel({
    model: config.geminiLiveModel,
    ...(config.geminiApiKey ? { apiKey: config.geminiApiKey } : {}),
    voice: settings.voice,
    temperature: settings.temperature,
    topP: settings.topP,
    maxOutputTokens: settings.maxOutputTokens,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  })
}

export default defineAgent({
  entry: async (ctx) => {
    const config = loadConfig()
    if (!config.geminiApiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required by the agent worker')
    const trusted = parseDispatchMetadata(ctx.job.metadata)
    const database = createDatabase(config)
    const pendingWrites = new Set<Promise<void>>()
    ctx.addShutdownCallback(async () => {
      await Promise.allSettled([...pendingWrites])
      await database.close()
    })
    const settings = await createAgentSettingsService(database.db).get(trusted.organizationId)
    const realtime = createRealtimeModel(config, settings)
    const session = new AgentSession({ llm: realtime })

    if (trusted.mode === 'test') {
      await session.start({ room: ctx.room, agent: createAgentPreview(settings), record: false })
      await ctx.connect()
      await session.generateReply({ instructions: `Say this welcome message exactly: "${settings.welcomeMessage}"` }).waitForPlayout()
      return
    }

    const attempts = createAttemptService(database.db, config.maxAssessmentAttempts)
    const resources = createResourceService(database.db, config)
    const authoritative = await attempts.getContext(trusted.organizationId, trusted.attemptId)
    if (authoritative.attempt.assessmentId !== trusted.assessmentId || authoritative.attempt.assessmentVersionId !== trusted.assessmentVersionId || authoritative.attempt.status !== 'IN_PROGRESS') throw new Error('Agent dispatch does not match an active attempt')
    const currentScenario = authoritative.scenarios.find((scenario) => scenario.id === authoritative.attempt.currentScenarioId)
    if (!currentScenario) throw new Error('Active attempt has no current scenario')
    let assessmentCompleted = false
    const tools = createAssessmentTools(trusted, attempts, resources, () => { assessmentCompleted = true })
    const persist = (operation: Promise<unknown>) => {
      const tracked = operation.then(() => undefined).catch(() => { ctx.shutdown('authoritative state persistence failed') }).finally(() => { pendingWrites.delete(tracked) })
      pendingWrites.add(tracked)
    }
    session.on(AgentSessionEventTypes.ConversationItemAdded, (event) => {
      if (event.item.type !== 'message') return
      const content = event.item.textContent
      if (!content) return
      const speaker = event.item.role === 'user' ? 'EMPLOYEE' : event.item.role === 'assistant' ? 'AGENT' : 'SYSTEM'
      persist(attempts.appendTurn({ organizationId: trusted.organizationId, attemptId: trusted.attemptId, speaker, content, startedAt: new Date(event.item.createdAt), endedAt: new Date(event.createdAt) }))
    })
    session.on(AgentSessionEventTypes.AgentStateChanged, (event) => {
      persist(attempts.recordEvent({ organizationId: trusted.organizationId, attemptId: trusted.attemptId, type: 'AGENT_STATE_CHANGED', payload: { state: event.newState } }))
      if (assessmentCompleted && event.newState === 'listening') ctx.shutdown('assessment completed')
    })
    session.on(AgentSessionEventTypes.Error, (event) => { persist(attempts.recordEvent({ organizationId: trusted.organizationId, attemptId: trusted.attemptId, type: 'AGENT_ERROR', payload: { message: String(event.error) } })) })
    await session.start({ room: ctx.room, agent: createInterviewerAgent({ assessmentName: authoritative.assessment.name, currentScenario, tools, settings }), record: false })
    await ctx.connect()
    await session.generateReply({ instructions: `Begin with this exact welcome message: "${settings.welcomeMessage}" Then briefly explain that the assessment has started and ask the current scenario question.` })
  },
})
