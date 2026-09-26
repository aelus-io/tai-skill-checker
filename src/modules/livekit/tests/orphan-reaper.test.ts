import type { Logger } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { AttemptService } from '../../attempts/index.js'
import { createOrphanSessionReaper, type LiveKitService } from '../index.js'

const candidate = {
  attemptId: 'attempt-1',
  organizationId: 'organization-1',
  roomName: 'assessment-attempt-1',
  employeeUserId: 'employee-1',
}

function setup(presence: 'MISSING' | 'PARTICIPANT_PRESENT' | 'PARTICIPANT_ABSENT') {
  const attempts = {
    findStaleSessions: vi.fn().mockResolvedValue([candidate]),
    transition: vi.fn().mockResolvedValue({ status: 'ABANDONED' }),
  } as unknown as AttemptService
  const livekit = {
    roomPresence: vi.fn().mockResolvedValue(presence),
    closeRooms: vi.fn().mockResolvedValue(undefined),
  } as unknown as LiveKitService
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger
  return { attempts, livekit, logger, reaper: createOrphanSessionReaper({ attempts, livekit, logger, timeoutMs: 300_000 }) }
}

describe('orphaned LiveKit session reaper', () => {
  it('abandons and closes an old room with no employee participant', async () => {
    const { attempts, livekit, reaper } = setup('PARTICIPANT_ABSENT')
    const now = new Date('2026-09-26T12:00:00.000Z')

    await reaper.runOnce(now)

    expect(attempts.findStaleSessions).toHaveBeenCalledWith(new Date('2026-09-26T11:55:00.000Z'))
    expect(livekit.roomPresence).toHaveBeenCalledWith(candidate.roomName, 'employee-employee-1')
    expect(attempts.transition).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: candidate.attemptId,
      to: 'ABANDONED',
      eventType: 'SESSION_ORPHAN_REAPED',
    }))
    expect(livekit.closeRooms).toHaveBeenCalledWith([candidate.roomName])
  })

  it('reconciles a stale active attempt whose room is already gone', async () => {
    const { attempts, livekit, reaper } = setup('MISSING')

    await reaper.runOnce()

    expect(attempts.transition).toHaveBeenCalledOnce()
    expect(livekit.closeRooms).toHaveBeenCalledOnce()
  })

  it('leaves a room alone while its expected employee is connected', async () => {
    const { attempts, livekit, reaper } = setup('PARTICIPANT_PRESENT')

    await reaper.runOnce()

    expect(attempts.transition).not.toHaveBeenCalled()
    expect(livekit.closeRooms).not.toHaveBeenCalled()
  })

  it('contains per-room failures so other cleanup cycles can continue', async () => {
    const { attempts, livekit, logger, reaper } = setup('PARTICIPANT_ABSENT')
    vi.mocked(attempts.transition).mockRejectedValue(new Error('attempt changed state'))

    await expect(reaper.runOnce()).resolves.toBeUndefined()

    expect(livekit.closeRooms).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('logs a failed scheduled cleanup cycle without stopping the service', async () => {
    vi.useFakeTimers()
    const { attempts, logger } = setup('PARTICIPANT_ABSENT')
    vi.mocked(attempts.findStaleSessions).mockRejectedValue(new Error('database unavailable'))
    const reaper = createOrphanSessionReaper({ attempts, livekit: setup('MISSING').livekit, logger, timeoutMs: 300_000, pollIntervalMs: 60_000 })

    reaper.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Orphaned assessment cleanup cycle failed')
    await reaper.stop()
    vi.useRealTimers()
  })
})
