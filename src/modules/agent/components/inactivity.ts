export type SpeechActivity = { user: boolean; agent: boolean }

/**
 * Fires `onTimeout` once when nobody in the room has spoken for `timeoutMs`.
 * The countdown is paused while either side is speaking and restarts from zero when speech ends.
 */
export function createInactivityTimer(timeoutMs: number, onTimeout: () => void) {
  const speaking: SpeechActivity = { user: false, agent: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false

  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (fired || speaking.user || speaking.agent) return
    timer = setTimeout(() => { fired = true; timer = undefined; onTimeout() }, timeoutMs)
  }

  return {
    start: arm,
    setSpeaking(side: keyof SpeechActivity, value: boolean) {
      if (speaking[side] === value) return
      speaking[side] = value
      arm()
    },
    stop() {
      fired = true
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}
