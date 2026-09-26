import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../../db/index.js'

const { deleteRoom, listRooms, listParticipants } = vi.hoisted(() => ({ deleteRoom: vi.fn(), listRooms: vi.fn(), listParticipants: vi.fn() }))

vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return { ...actual, RoomServiceClient: class { deleteRoom = deleteRoom; listRooms = listRooms; listParticipants = listParticipants } }
})

import { createLiveKitService } from '../index.js'

describe('LiveKit room cleanup', () => {
  beforeEach(() => {
    deleteRoom.mockReset()
    listRooms.mockReset()
    listParticipants.mockReset()
  })

  const service = () => createLiveKitService({} as Database, {
    livekitUrl: 'wss://example.livekit.cloud',
    livekitApiKey: 'key',
    livekitApiSecret: 'secret',
    livekitAgentName: 'assessment-interviewer',
    livekitTokenTtlSeconds: 300,
  })

  it('ends each unique unfinished room and tolerates rooms that already closed', async () => {
    deleteRoom.mockRejectedValueOnce(new Error('room already closed')).mockResolvedValue(undefined)
    await expect(service().closeRooms(['room-1', 'room-1', 'room-2'])).resolves.toBeUndefined()
    expect(deleteRoom).toHaveBeenCalledTimes(2)
    expect(deleteRoom).toHaveBeenCalledWith('room-1')
    expect(deleteRoom).toHaveBeenCalledWith('room-2')
  })

  it('distinguishes a missing room, an agent-only room, and the expected employee', async () => {
    listRooms.mockResolvedValueOnce([])
    await expect(service().roomPresence('room-1', 'employee-1')).resolves.toBe('MISSING')
    expect(listParticipants).not.toHaveBeenCalled()

    listRooms.mockResolvedValueOnce([{ name: 'room-1' }])
    listParticipants.mockResolvedValueOnce([{ identity: 'agent-1' }])
    await expect(service().roomPresence('room-1', 'employee-1')).resolves.toBe('PARTICIPANT_ABSENT')

    listRooms.mockResolvedValueOnce([{ name: 'room-1' }])
    listParticipants.mockResolvedValueOnce([{ identity: 'agent-1' }, { identity: 'employee-1' }])
    await expect(service().roomPresence('room-1', 'employee-1')).resolves.toBe('PARTICIPANT_PRESENT')
  })
})
