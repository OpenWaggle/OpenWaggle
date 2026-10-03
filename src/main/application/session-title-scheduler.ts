import { SessionId, type SupportedModelId } from '@shared/types/brand'
import type {
  SessionLifecycleRequest,
  SessionLifecycleResponse,
} from '@shared/types/session-lifecycle'
import type { SessionTitleRegenerationResult } from '@shared/types/session-title'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import type { SessionTitleContextAttachment } from '../domain/session-title/session-title-context'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionTitleGenerator } from '../ports/session-title-generator'
import type { SessionTitleRepository } from '../ports/session-title-repository'
import type { SettingsService } from '../services/settings-service'
import { recoverSessionTitleWork } from './session-title-recovery'
import { refineSessionTitle } from './session-title-refinement'
import { generateInitialSessionTitle, regenerateSessionTitle } from './session-title-service'

type SessionTitleWorkContext =
  | SessionTitleRepository
  | SessionTitleGenerator
  | SettingsService
  | SessionProjectionRepository

/**
 * Title work runs in the Session Host's runtime, detached from the Run or Spawn that asked for it,
 * so a slow or failing Title model can never delay a stream or cost a durable turn (ADR 0037).
 * Outside the Host nothing is installed and requests are ignored.
 */
let titleRuntime: Runtime.Runtime<SessionTitleWorkContext> | null = null

export const installSessionTitleWorker = Effect.gen(function* () {
  titleRuntime = yield* Effect.runtime<SessionTitleWorkContext>()
  Runtime.runFork(titleRuntime)(recoverSessionTitleWork)
})

/** Generate a title for a Session that still has its default or Provisional title. */
export function requestInitialSessionTitle(input: {
  readonly sessionId: SessionId
  readonly text: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
  readonly model?: SupportedModelId | null
  readonly settleOnFailure?: boolean
}) {
  if (!titleRuntime) return
  Runtime.runFork(titleRuntime)(generateInitialSessionTitle(input))
}

/**
 * A Worker's title is generated from its Delegation objective as soon as it is spawned, and an
 * untitled launched root's from its objective as soon as it is launched, so a Session whose first
 * Run waits behind a concurrency limit or a worktree setup still gets a recognizable title.
 */
export function requestLifecycleTitle(
  request: SessionLifecycleRequest,
  response: SessionLifecycleResponse,
) {
  if (response.replayed) return
  const { command } = request
  const { outcome } = response
  if (outcome.effect === 'spawned-worker' && command.operation === 'spawn') {
    requestInitialSessionTitle({
      sessionId: SessionId(outcome.sessionId),
      text: command.delegation.objective,
      settleOnFailure: false,
    })
    return
  }
  // A launch with attachments is titled by its first Run, which knows the attachment names.
  if (
    outcome.effect === 'launched-root' &&
    command.operation === 'launch' &&
    command.title === undefined &&
    (command.attachmentIds ?? []).length === 0
  ) {
    requestInitialSessionTitle({
      sessionId: SessionId(outcome.sessionId),
      text: command.objective,
      settleOnFailure: false,
    })
  }
}

/** Run an owed Title refinement once the first turn has answered. */
export function requestSessionTitleRefinement(sessionId: SessionId) {
  if (!titleRuntime) return
  Runtime.runFork(titleRuntime)(refineSessionTitle(sessionId))
}

export function runSessionTitleRegeneration(
  sessionId: SessionId,
): Promise<SessionTitleRegenerationResult> {
  if (!titleRuntime) {
    return Promise.resolve({
      outcome: 'failed',
      message: 'Title regeneration is not available until the Session Host is running.',
    })
  }
  return Runtime.runPromise(titleRuntime)(
    regenerateSessionTitle(sessionId).pipe(
      Effect.catchAllCause(() =>
        Effect.succeed({
          outcome: 'failed',
          message: 'The title could not be regenerated.',
        } satisfies SessionTitleRegenerationResult),
      ),
    ),
  )
}
