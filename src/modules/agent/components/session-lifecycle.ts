export type AttemptEndReason = {
  eventType: 'SESSION_INACTIVITY_TIMEOUT' | 'SESSION_DISCONNECTED'
  payload?: Record<string, unknown>
}

export function createAttemptSessionFinalizer(
  abandon: (reason: AttemptEndReason) => Promise<void>,
) {
  let completed = false
  let abandonmentReason: AttemptEndReason | undefined
  let abandonment: Promise<void> | undefined

  return {
    markCompleted() {
      completed = true
    },
    abandon(reason: AttemptEndReason) {
      if (completed) return Promise.resolve()
      abandonmentReason ??= reason
      abandonment ??= abandon(abandonmentReason).catch((error: unknown) => {
        abandonment = undefined
        throw error
      })
      return abandonment
    },
  }
}

export async function deliverClosingMessageAndShutdown(
  session: {
    input: { setAudioEnabled(enabled: boolean): void }
    say(message: string, options: { allowInterruptions: boolean }): { waitForPlayout(): Promise<void> }
  },
  closingMessage: string,
  shutdown: () => void,
) {
  session.input.setAudioEnabled(false)
  try {
    await session.say(closingMessage, { allowInterruptions: false }).waitForPlayout()
  } catch {
    // A playback failure must not leave a completed assessment connected.
  } finally {
    shutdown()
  }
}
