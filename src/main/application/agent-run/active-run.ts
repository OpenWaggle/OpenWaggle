import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { SessionRepository } from '../../ports/session-repository'
import { resolveActiveBranchId } from './branch'
import type { ActiveRunIdentity, AgentRunInput } from './types'

const logger = createLogger('agent-run-service')

export function recordDurableActiveRun(input: AgentRunInput) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    const sessionTree = yield* sessionRepo.getTree(input.sessionId)
    const branchId = resolveActiveBranchId(input.sessionId, sessionTree)
    yield* sessionRepo.clearInterruptedRuns({ sessionId: input.sessionId, branchId })
    yield* sessionRepo.recordActiveRun({
      runId: input.runId,
      sessionId: input.sessionId,
      branchId,
      runMode: 'classic',
      model: input.model,
    })
    return { sessionRepo, identity: { sessionId: input.sessionId, runId: input.runId } }
  })
}

export function clearDurableActiveRun(getActiveRunIdentity: () => ActiveRunIdentity | null) {
  return Effect.gen(function* () {
    const activeRunIdentity = getActiveRunIdentity()
    if (!activeRunIdentity) return

    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.clearActiveRun(activeRunIdentity).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Failed to clear durable active run', {
            sessionId: activeRunIdentity.sessionId,
            runId: activeRunIdentity.runId,
            error: formatErrorMessage(error),
          })
        }),
      ),
    )
  })
}
