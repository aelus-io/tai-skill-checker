import type { Logger } from 'pino'
import type { AttemptService } from '../../attempts/index.js'
import type { LiveKitService } from './service.js'

type ReaperAttempts = Pick<AttemptService, 'findStaleSessions' | 'transition'>
type ReaperLiveKit = Pick<LiveKitService, 'roomPresence' | 'closeRooms'>

export function createOrphanSessionReaper(input: {
  attempts: ReaperAttempts
  livekit: ReaperLiveKit
  logger: Logger
  timeoutMs: number
  pollIntervalMs?: number
}) {
  const pollIntervalMs = input.pollIntervalMs ?? 60_000
  let timer: NodeJS.Timeout | undefined
  let active: Promise<void> | undefined
  let stopping = false

  async function runOnce(now = new Date()) {
    const before = new Date(now.getTime() - input.timeoutMs)
    const candidates = await input.attempts.findStaleSessions(before)
    for (const candidate of candidates) {
      try {
        const presence = await input.livekit.roomPresence(candidate.roomName, `employee-${candidate.employeeUserId}`)
        if (presence === 'PARTICIPANT_PRESENT') continue
        await input.attempts.transition({
          organizationId: candidate.organizationId,
          attemptId: candidate.attemptId,
          to: 'ABANDONED',
          eventType: 'SESSION_ORPHAN_REAPED',
          idempotencyKey: `orphan-reaper:${candidate.attemptId}`,
          payload: { timeoutSeconds: Math.round(input.timeoutMs / 1_000), roomPresence: presence },
        })
        await input.livekit.closeRooms([candidate.roomName])
        input.logger.info({ attemptId: candidate.attemptId, roomName: candidate.roomName, presence }, 'Orphaned assessment session cleaned up')
      } catch (error) {
        input.logger.error({ err: error, attemptId: candidate.attemptId, roomName: candidate.roomName }, 'Orphaned assessment cleanup failed')
      }
    }
  }

  function schedule() {
    if (stopping) return
    timer = setTimeout(() => {
      active = runOnce()
        .catch((error: unknown) => { input.logger.error({ err: error }, 'Orphaned assessment cleanup cycle failed') })
        .finally(() => { active = undefined; schedule() })
    }, pollIntervalMs)
    timer.unref()
  }

  function start() {
    if (stopping || active || timer) return
    active = runOnce()
      .catch((error: unknown) => { input.logger.error({ err: error }, 'Orphaned assessment cleanup cycle failed') })
      .finally(() => { active = undefined; schedule() })
  }

  async function stop() {
    stopping = true
    if (timer) clearTimeout(timer)
    await active
  }

  return { start, stop, runOnce }
}

export type OrphanSessionReaper = ReturnType<typeof createOrphanSessionReaper>
