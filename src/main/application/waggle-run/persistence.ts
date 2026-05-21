import type { SessionId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import type {
  AgentKernelRunResult,
  AgentKernelSessionSnapshot,
} from '../../ports/agent-kernel-service'
import { SessionRepository } from '../../ports/session-repository'

const logger = createLogger('waggle-run-service')

export function persistWaggleSnapshot(input: {
  readonly sessionId: SessionId
  readonly result: AgentKernelRunResult
  readonly snapshot: AgentKernelSessionSnapshot
  readonly waggleConfig: WaggleConfig | undefined
}) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: input.sessionId,
      nodes: input.snapshot.nodes,
      activeNodeId: input.snapshot.activeNodeId,
      piSessionId: input.result.piSessionId,
      piSessionFile: input.result.piSessionFile,
      waggleConfig: input.waggleConfig,
    })
  }).pipe(
    Effect.tapError((persistError) =>
      Effect.sync(() =>
        logger.error('Failed to persist Waggle session snapshot', {
          sessionId: input.sessionId,
          error: formatErrorMessage(persistError),
        }),
      ),
    ),
  )
}
