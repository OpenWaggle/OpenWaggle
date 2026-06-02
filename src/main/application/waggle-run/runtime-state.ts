import { SessionBranchId, type SessionId, type SupportedModelId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { SessionRepository } from '../../ports/session-repository'

const MAIN_BRANCH_NAME = 'main'
const logger = createLogger('waggle-run-service')

export interface WaggleActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}

function mainBranchFallbackId(sessionId: SessionId) {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

export function resolveWaggleBranchId(input: {
  readonly sessionId: SessionId
  readonly tree: SessionTree | null
}) {
  return (
    input.tree?.session.lastActiveBranchId ??
    input.tree?.branches.find((branch) => branch.isMain)?.id ??
    mainBranchFallbackId(input.sessionId)
  )
}

export function clearDurableWaggleActiveRun(
  getActiveRunIdentity: () => WaggleActiveRunIdentity | null,
) {
  return Effect.gen(function* () {
    const activeRunIdentity = getActiveRunIdentity()
    if (!activeRunIdentity) return

    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.clearActiveRun(activeRunIdentity).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Failed to clear durable Waggle active run', {
            sessionId: activeRunIdentity.sessionId,
            runId: activeRunIdentity.runId,
            error: formatErrorMessage(error),
          })
        }),
      ),
    )
  })
}

export function recordDurableWaggleRun(input: {
  readonly branchId: SessionBranchId
  readonly run: WaggleActiveRunIdentity
  readonly runtimeModel: SupportedModelId
  readonly sessionRepo: typeof SessionRepository.Service
}) {
  return Effect.gen(function* () {
    yield* input.sessionRepo.clearInterruptedRuns({
      sessionId: input.run.sessionId,
      branchId: input.branchId,
    })
    yield* input.sessionRepo.recordActiveRun({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      branchId: input.branchId,
      runMode: 'waggle',
      model: input.runtimeModel,
    })
  })
}
