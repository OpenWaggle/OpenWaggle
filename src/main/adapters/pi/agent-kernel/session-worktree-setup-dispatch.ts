import { matchBy } from '@diegogbrisa/ts-match'
import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { createLogger } from '../../../logger'
import type {
  ClaimedSessionWorktreeSetup,
  PendingSessionWorktreeSetup,
} from '../../../store/session-details'
import {
  claimSessionWorktreeSetup,
  completeSessionWorktreeSetup,
  getSessionWorktreeSetupDispatch,
  releaseSessionWorktreeSetupClaim,
} from '../../../store/session-details'

const logger = createLogger('session-worktree-setup-dispatch')

export interface SessionWorktreeSetupDispatchOptions {
  readonly onProgress?: (progress: WorktreeLaunchProgress) => void
  /** Resolves after semantic terminal acceptance and rejects only before acceptance. */
  readonly onSetupPending?: (input: {
    readonly session: SessionDetail
    readonly primaryPath: string
    readonly worktreePath: string
    readonly setupGeneration: string
    readonly branch?: string
    readonly baseRef?: string
  }) => Promise<void>
  readonly signal?: AbortSignal
}

interface SessionWorktreeSetupDispatchInput {
  readonly session: SessionDetail
  readonly options: SessionWorktreeSetupDispatchOptions
  readonly primaryPath: string
  readonly sessionId: string
  readonly worktreePath: string
  readonly branch?: string
  readonly baseRef?: string
  readonly pending?: PendingSessionWorktreeSetup
}

function progressWithDetails(
  input: SessionWorktreeSetupDispatchInput,
  details: readonly string[],
): WorktreeLaunchProgress {
  return {
    stage: 'worktree-created',
    details,
    worktreePath: input.worktreePath,
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.baseRef ? { baseRef: input.baseRef } : {}),
  }
}

function reportIndeterminateClaim(
  input: SessionWorktreeSetupDispatchInput,
  claim: ClaimedSessionWorktreeSetup,
) {
  logger.warn('Project Setup action has an indeterminate durable claim', {
    sessionId: input.sessionId,
    worktreePath: input.worktreePath,
    setupGeneration: claim.generation,
  })
  input.options.onProgress?.(
    progressWithDetails(input, [
      'Project Setup action was interrupted after dispatch was reserved. It was not started again automatically because the previous command may have reached the shell.',
    ]),
  )
}

async function resolvePendingDispatch(
  id: SessionId,
  input: SessionWorktreeSetupDispatchInput,
): Promise<PendingSessionWorktreeSetup | null> {
  if (input.pending) return input.pending
  const persisted = await getSessionWorktreeSetupDispatch(id)
  if (!persisted || persisted.worktreePath !== input.worktreePath) return null
  return matchBy(persisted, 'state')
    .with('pending', (pending) => pending)
    .with('claimed', (claim) => {
      reportIndeterminateClaim(input, claim)
      return null
    })
    .with('accepted', () => null)
    .exhaustive()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function restorePendingAfterFailure(
  id: SessionId,
  input: SessionWorktreeSetupDispatchInput,
  claim: ClaimedSessionWorktreeSetup,
  error: unknown,
) {
  let message = errorMessage(error)
  try {
    await releaseSessionWorktreeSetupClaim(id, claim)
  } catch (releaseError) {
    message = `${message}. OpenWaggle could not restore automatic retry: ${errorMessage(releaseError)}`
  }
  logger.warn('Project Setup action was not dispatched', {
    sessionId: input.sessionId,
    worktreePath: input.worktreePath,
    setupGeneration: claim.generation,
    error: message,
  })
  input.options.onProgress?.(
    progressWithDetails(input, [`Project Setup action did not start: ${message}`]),
  )
}

async function finalizeAcceptedDispatch(
  id: SessionId,
  input: SessionWorktreeSetupDispatchInput,
  claim: ClaimedSessionWorktreeSetup,
) {
  try {
    await completeSessionWorktreeSetup(id, claim)
  } catch (error) {
    const message = errorMessage(error)
    logger.warn('Project Setup action receipt could not be finalized', {
      sessionId: input.sessionId,
      worktreePath: input.worktreePath,
      setupGeneration: claim.generation,
      error: message,
    })
    input.options.onProgress?.(
      progressWithDetails(input, [
        `Project Setup action reached the terminal, but its receipt could not be finalized: ${message}. It will not be started again automatically.`,
      ]),
    )
  }
}

export async function dispatchPendingSessionWorktreeSetup(
  input: SessionWorktreeSetupDispatchInput,
) {
  const { session, options, primaryPath, sessionId, worktreePath } = input
  const onSetupPending = options.onSetupPending
  if (!onSetupPending) return

  const id = SessionId(sessionId)
  const pending = await resolvePendingDispatch(id, input)
  if (!pending || pending.worktreePath !== worktreePath) return

  options.signal?.throwIfAborted()
  const claim = await claimSessionWorktreeSetup(id, pending)
  if (!claim) return

  try {
    options.signal?.throwIfAborted()
    await onSetupPending({
      session,
      primaryPath,
      worktreePath,
      setupGeneration: claim.generation,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.baseRef ? { baseRef: input.baseRef } : {}),
    })
  } catch (error) {
    await restorePendingAfterFailure(id, input, claim, error)
    return
  }

  await finalizeAcceptedDispatch(id, input, claim)
}
