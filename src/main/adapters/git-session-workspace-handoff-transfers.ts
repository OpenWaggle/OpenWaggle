import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import {
  type PreparedWorkspaceHandoff,
  SessionWorkspaceHandoffPreparationError,
} from '../ports/session-workspace-handoff-service'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'
import {
  captureExistingWorkspaceSeeds,
  captureNewWorkspaceSeed,
  handoffPreparationError,
  preparedWorkspaceId,
} from './git/session-workspace-handoff-preparation'
import { releaseWorkspaceHandoffSeed } from './git/workspace-handoff-snapshot'

/*
 * Seed capture for a Workspace handoff, split from `git-session-workspace-handoff-service`:
 * that module resolves rows and the target Workspace, this one touches Git.
 *
 * Every Git failure here is a typed `SessionWorkspaceHandoffPreparationError`, never a defect.
 * A preparation refusal is a pick the caller presents (`workspace_base_ref_mismatch`), and the
 * session organization service only classifies it because it arrives in the error channel; as a
 * defect it skipped every refusal path and surfaced to the composer as an unhandled host error.
 */

/** The operation a Workspace id is derived from, so a replay addresses the same Workspace. */
interface TransferIdentity {
  readonly callerId: string
  readonly sessionId: string
  readonly idempotencyKey: string
}

function transferError(cause: unknown) {
  return cause instanceof SessionWorkspaceHandoffPreparationError
    ? cause
    : handoffPreparationError('workspace_snapshot_failed', cause)
}

export function prepareNewWorkspaceTransfer(input: {
  readonly identity: TransferIdentity
  readonly projectPath: string
  readonly workingPath: string
  readonly baseRef?: string
}) {
  const workspaceId = preparedWorkspaceId(input.identity)
  return Effect.tryPromise({
    try: () =>
      captureNewWorkspaceSeed({
        projectPath: input.projectPath,
        workingPath: input.workingPath,
        workspaceId,
        ...(input.baseRef ? { requestedBaseRef: input.baseRef } : {}),
      }),
    catch: transferError,
  }).pipe(
    Effect.map(
      (seed) =>
        ({
          transfer: 'deferred-new-worktree',
          workspaceId,
          projectPath: input.projectPath,
          workingPath: resolveWorkspaceWorktreePath(input.projectPath, workspaceId),
          worktreeBranch: sessionWorktreeBranchForId(workspaceId),
          sourceHead: seed.sourceHead,
          snapshotRef: seed.snapshotRef,
        }) satisfies PreparedWorkspaceHandoff,
    ),
  )
}

/**
 * Capture both ends of an existing-Workspace transfer. A replayed operation whose reserved seed
 * no longer matches releases what it just captured and reports no transfer.
 */
export function prepareExistingWorkspaceTransfer(input: {
  readonly identity: TransferIdentity
  readonly workspaceId: string
  readonly projectPath: string
  readonly sourceWorkingPath: string
  readonly workingPath: string
  /** A pending replay's reserved seed, which this attempt has to reproduce exactly. */
  readonly replay?: { readonly reservedSeedRef: string | null }
}) {
  const transferId = `${preparedWorkspaceId(input.identity)}-transfer`
  return Effect.tryPromise({
    try: () =>
      captureExistingWorkspaceSeeds({
        projectPath: input.projectPath,
        sourceWorkingPath: input.sourceWorkingPath,
        targetWorkingPath: input.workingPath,
        transferId,
      }),
    catch: transferError,
  }).pipe(
    Effect.flatMap((seeds) => {
      const replayMismatch =
        input.replay !== undefined && input.replay.reservedSeedRef !== seeds.source.snapshotRef
      if (!replayMismatch) {
        return Effect.succeed({
          transfer: 'deferred-existing',
          workspaceId: input.workspaceId,
          projectPath: input.projectPath,
          sourceWorkingPath: input.sourceWorkingPath,
          workingPath: input.workingPath,
          sourceHead: seeds.source.sourceHead,
          snapshotRef: seeds.source.snapshotRef,
          targetSnapshotRef: seeds.target.snapshotRef,
        } satisfies PreparedWorkspaceHandoff)
      }
      return Effect.tryPromise({
        try: () =>
          Promise.all([
            releaseWorkspaceHandoffSeed(input.projectPath, seeds.source.snapshotRef),
            releaseWorkspaceHandoffSeed(input.projectPath, seeds.target.snapshotRef),
          ]).then(() => undefined),
        catch: transferError,
      }).pipe(Effect.as(undefined))
    }),
  )
}
