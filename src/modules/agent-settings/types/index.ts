import { z } from 'zod'

export const agentVoices = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'] as const

export const agentSettingsSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(8_000),
  welcomeMessage: z.string().trim().min(1).max(1_000),
  closingMessage: z.string().trim().min(1).max(1_000),
  voice: z.enum(agentVoices),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(64).max(8_192),
})

export type AgentSettings = z.infer<typeof agentSettingsSchema>

export const defaultAgentSettings: AgentSettings = {
  systemPrompt: 'Use a calm, professional, and encouraging tone. Keep spoken responses concise, ask one question at a time, and give the speaker enough time to think.',
  welcomeMessage: 'Welcome. This voice assessment is ready to begin.',
  closingMessage: 'Thank you. The assessment is now complete, and your responses have been submitted.',
  voice: 'Kore',
  temperature: 0.8,
  topP: 0.95,
  maxOutputTokens: 1_024,
}
