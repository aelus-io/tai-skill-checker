import { describe, expect, it, vi } from 'vitest'
import { createAttemptSessionFinalizer, deliverClosingMessageAndShutdown } from '../index.js'

describe('attempt agent session lifecycle', () => {
  it('abandons a disconnected attempt exactly once', async () => {
    const abandon = vi.fn(async () => {})
    const finalizer = createAttemptSessionFinalizer(abandon)
    const reason = { eventType: 'SESSION_DISCONNECTED' as const, payload: { reason: 'participant_disconnected' } }

    await Promise.all([finalizer.abandon(reason), finalizer.abandon(reason)])

    expect(abandon).toHaveBeenCalledOnce()
    expect(abandon).toHaveBeenCalledWith(reason)
  })

  it('preserves the inactivity reason when shutdown cleanup races it', async () => {
    const abandon = vi.fn(async () => {})
    const finalizer = createAttemptSessionFinalizer(abandon)

    await Promise.all([
      finalizer.abandon({ eventType: 'SESSION_INACTIVITY_TIMEOUT', payload: { timeoutSeconds: 300 } }),
      finalizer.abandon({ eventType: 'SESSION_DISCONNECTED' }),
    ])

    expect(abandon).toHaveBeenCalledOnce()
    expect(abandon).toHaveBeenCalledWith({ eventType: 'SESSION_INACTIVITY_TIMEOUT', payload: { timeoutSeconds: 300 } })
  })

  it('never abandons an assessment after authoritative completion', async () => {
    const abandon = vi.fn(async () => {})
    const finalizer = createAttemptSessionFinalizer(abandon)
    finalizer.markCompleted()

    await finalizer.abandon({ eventType: 'SESSION_DISCONNECTED' })

    expect(abandon).not.toHaveBeenCalled()
  })

  it('retries a failed write with the original terminal reason', async () => {
    const abandon = vi.fn()
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce(undefined)
    const finalizer = createAttemptSessionFinalizer(abandon)
    const inactivity = { eventType: 'SESSION_INACTIVITY_TIMEOUT' as const, payload: { timeoutSeconds: 300 } }

    await expect(finalizer.abandon(inactivity)).rejects.toThrow('temporary database failure')
    await finalizer.abandon({ eventType: 'SESSION_DISCONNECTED' })

    expect(abandon).toHaveBeenCalledTimes(2)
    expect(abandon).toHaveBeenLastCalledWith(inactivity)
  })

  it('blocks further input and shuts down only after the non-interruptible closing message', async () => {
    let finishPlayout!: () => void
    const playout = new Promise<void>((resolve) => { finishPlayout = resolve })
    const setAudioEnabled = vi.fn()
    const say = vi.fn(() => ({ waitForPlayout: () => playout }))
    const shutdown = vi.fn()

    const closing = deliverClosingMessageAndShutdown({ input: { setAudioEnabled }, say }, 'Thank you. The assessment is complete.', shutdown)

    expect(setAudioEnabled).toHaveBeenCalledWith(false)
    expect(say).toHaveBeenCalledWith('Thank you. The assessment is complete.', { allowInterruptions: false })
    expect(shutdown).not.toHaveBeenCalled()
    finishPlayout()
    await closing
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('still shuts down when closing-message playback fails', async () => {
    const shutdown = vi.fn()
    await deliverClosingMessageAndShutdown({
      input: { setAudioEnabled: vi.fn() },
      say: vi.fn(() => ({ waitForPlayout: () => Promise.reject(new Error('playback failed')) })),
    }, 'Thank you.', shutdown)

    expect(shutdown).toHaveBeenCalledOnce()
  })
})
