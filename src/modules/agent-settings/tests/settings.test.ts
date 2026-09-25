import { describe, expect, it } from 'vitest'
import { agentSettingsSchema, defaultAgentSettings } from '../index.js'

describe('agent settings', () => {
  it('provides a complete, valid configuration for organizations without saved settings', () => {
    expect(agentSettingsSchema.parse(defaultAgentSettings)).toEqual(defaultAgentSettings)
  })

  it('rejects unsafe or provider-invalid generation values', () => {
    expect(() => agentSettingsSchema.parse({ ...defaultAgentSettings, temperature: 2.1 })).toThrow()
    expect(() => agentSettingsSchema.parse({ ...defaultAgentSettings, topP: -0.1 })).toThrow()
    expect(() => agentSettingsSchema.parse({ ...defaultAgentSettings, maxOutputTokens: 8 })).toThrow()
    expect(() => agentSettingsSchema.parse({ ...defaultAgentSettings, voice: 'Unknown' })).toThrow()
  })

  it('trims authored messages before they are persisted or used in a session', () => {
    const parsed = agentSettingsSchema.parse({ ...defaultAgentSettings, welcomeMessage: '  Welcome aboard.  ' })
    expect(parsed.welcomeMessage).toBe('Welcome aboard.')
  })
})
