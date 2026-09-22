import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../../db/index.js'

const { deleteRoom } = vi.hoisted(() => ({ deleteRoom: vi.fn() }))

vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return { ...actual, RoomServiceClient: class { deleteRoom = deleteRoom } }
})

import { createLiveKitService } from '../index.js'

describe('LiveKit room cleanup', () => {
  beforeEach(() => deleteRoom.mockReset())

  it('ends each unique unfinished room and tolerates rooms that already closed', async () => {
    deleteRoom.mockRejectedValueOnce(new Error('room already closed')).mockResolvedValue(undefined)
    const service = createLiveKitService({} as Database, {
      livekitUrl: 'wss://example.livekit.cloud',
      livekitApiKey: 'key',
      livekitApiSecret: 'secret',
      livekitAgentName: 'assessment-interviewer',
      livekitTokenTtlSeconds: 300,
    })

    await expect(service.closeRooms(['room-1', 'room-1', 'room-2'])).resolves.toBeUndefined()
    expect(deleteRoom).toHaveBeenCalledTimes(2)
    expect(deleteRoom).toHaveBeenCalledWith('room-1')
    expect(deleteRoom).toHaveBeenCalledWith('room-2')
  })
})
