import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInactivityTimer } from '../index.js'

describe('agent inactivity timer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('fires once after the full silent period', () => {
    const onTimeout = vi.fn()
    createInactivityTimer(1000, onTimeout).start()
    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    vi.advanceTimersByTime(5000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('pauses while anyone speaks and restarts the countdown when speech ends', () => {
    const onTimeout = vi.fn()
    const timer = createInactivityTimer(1000, onTimeout)
    timer.start()
    vi.advanceTimersByTime(900)
    timer.setSpeaking('user', true)
    vi.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
    timer.setSpeaking('user', false)
    timer.setSpeaking('agent', true)
    timer.setSpeaking('agent', false)
    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('never fires after being stopped', () => {
    const onTimeout = vi.fn()
    const timer = createInactivityTimer(1000, onTimeout)
    timer.start()
    timer.stop()
    timer.setSpeaking('user', false)
    vi.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
