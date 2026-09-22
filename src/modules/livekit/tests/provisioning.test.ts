import { EgressStatus, ParticipantInfo_Kind } from '@livekit/protocol'
import { describe, expect, it, vi } from 'vitest'
import { waitForRealtimeInfrastructure } from '../index.js'

describe('LiveKit session provisioning', () => {
  it('waits until both the agent and recording are ready', async () => {
    const listParticipants = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ kind: ParticipantInfo_Kind.AGENT }])
    const listEgress = vi.fn()
      .mockResolvedValueOnce([{ status: EgressStatus.EGRESS_STARTING }])
      .mockResolvedValue([{ status: EgressStatus.EGRESS_ACTIVE }])

    await expect(waitForRealtimeInfrastructure({
      roomName: 'assessment-attempt-1',
      egressId: 'egress-1',
      roomClient: { listParticipants },
      egressClient: { listEgress },
      timeoutMs: 100,
      pollIntervalMs: 0,
    })).resolves.toBeUndefined()

    expect(listParticipants).toHaveBeenCalledTimes(2)
    expect(listEgress).toHaveBeenCalledWith({ egressId: 'egress-1' })
  })

  it('fails provisioning with the recording service error', async () => {
    await expect(waitForRealtimeInfrastructure({
      roomName: 'assessment-attempt-1',
      egressId: 'egress-1',
      roomClient: { listParticipants: vi.fn().mockResolvedValue([{ kind: ParticipantInfo_Kind.AGENT }]) },
      egressClient: { listEgress: vi.fn().mockResolvedValue([{ status: EgressStatus.EGRESS_FAILED, error: 'certificate mismatch' }]) },
      timeoutMs: 100,
      pollIntervalMs: 0,
    })).rejects.toThrow('certificate mismatch')
  })

  it('fails provisioning when the agent never joins', async () => {
    await expect(waitForRealtimeInfrastructure({
      roomName: 'assessment-attempt-1',
      egressId: 'egress-1',
      roomClient: { listParticipants: vi.fn().mockResolvedValue([]) },
      egressClient: { listEgress: vi.fn().mockResolvedValue([{ status: EgressStatus.EGRESS_ACTIVE }]) },
      timeoutMs: 1,
      pollIntervalMs: 1,
    })).rejects.toThrow('startup timeout')
  })
})
