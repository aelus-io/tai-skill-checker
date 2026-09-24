import type { Logger } from 'pino'
import type { EvaluationService } from './service.js'

export function createEvaluationWorker(service: EvaluationService, logger: Logger, pollIntervalMs = 5_000) {
  let timer: NodeJS.Timeout | undefined
  let stopping = false
  let active: Promise<void> | undefined

  async function tick() {
    if (stopping) return
    const claim = await service.claimNext()
    if (claim) {
      logger.info({ evaluationId: claim.id, attemptId: claim.attemptId }, 'Evaluation claimed')
      await service.execute(claim)
    }
  }

  function schedule() {
    if (stopping) return
    timer = setTimeout(() => {
      active = tick().catch((error: unknown) => logger.error({ err: error }, 'Evaluation worker iteration failed')).finally(() => { active = undefined; schedule() })
    }, pollIntervalMs)
    timer.unref()
  }

  function start() { schedule() }
  async function stop() {
    stopping = true
    if (timer) clearTimeout(timer)
    await active
  }
  async function runOnce() { await tick() }
  return { start, stop, runOnce }
}
