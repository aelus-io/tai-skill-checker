import { eq } from 'drizzle-orm'
import type { Database } from '../../../db/index.js'
import { organizationAgentSettings } from '../../../db/schema.js'
import { agentSettingsSchema, defaultAgentSettings, type AgentSettings } from '../types/index.js'

const selectSettings = {
  systemPrompt: organizationAgentSettings.systemPrompt,
  welcomeMessage: organizationAgentSettings.welcomeMessage,
  closingMessage: organizationAgentSettings.closingMessage,
  voice: organizationAgentSettings.voice,
  temperature: organizationAgentSettings.temperature,
  topP: organizationAgentSettings.topP,
  maxOutputTokens: organizationAgentSettings.maxOutputTokens,
}

export function createAgentSettingsService(db: Database) {
  async function get(organizationId: string): Promise<AgentSettings> {
    const [stored] = await db.select(selectSettings).from(organizationAgentSettings).where(eq(organizationAgentSettings.organizationId, organizationId)).limit(1)
    return stored ? agentSettingsSchema.parse(stored) : defaultAgentSettings
  }

  async function update(organizationId: string, input: AgentSettings): Promise<AgentSettings> {
    const settings = agentSettingsSchema.parse(input)
    const [saved] = await db.insert(organizationAgentSettings).values({ organizationId, ...settings }).onConflictDoUpdate({
      target: organizationAgentSettings.organizationId,
      set: { ...settings, updatedAt: new Date() },
    }).returning(selectSettings)
    return agentSettingsSchema.parse(saved)
  }

  return { get, update }
}

export type AgentSettingsService = ReturnType<typeof createAgentSettingsService>
