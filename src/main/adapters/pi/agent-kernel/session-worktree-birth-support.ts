import type { SessionDetail } from '@shared/types/session'
import { resolveWorkspaceWorktreePath } from '../../../services/git/session-worktree-path'
import type { BoundWorkspaceResource } from '../../../store/session-details'
import { runGit } from '../../git/run-git'
import {
  applyWorkspaceHandoffSeed,
  releaseWorkspaceHandoffSeed,
} from '../../git/workspace-handoff-snapshot'

export function fallbackWorkspace(
  session: SessionDetail,
  primaryPath: string,
): BoundWorkspaceResource {
  const sessionId = String(session.id)
  return {
    id: sessionId,
    projectPath: primaryPath,
    kind: 'managed-worktree',
    workingPath: session.worktreePath ?? resolveWorkspaceWorktreePath(primaryPath, sessionId),
    lifecycleState: session.worktreePath ? 'ready' : 'pending',
    worktreeBranch: null,
    worktreeBaseRef: session.worktreeBaseRef ?? null,
    worktreeStartFromOrigin: session.worktreeStartFromOrigin === true,
    handoffSeedRef: null,
    handoffSeedBaseRef: null,
    handoffSeedState: 'none',
  }
}

export async function isWorktreeOf(
  repositoryPath: string,
  candidatePath: string,
): Promise<boolean> {
  const [candidate, primary] = await Promise.all([
    runGit(candidatePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    runGit(repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  if (candidate.code !== 0 || primary.code !== 0) return false
  return candidate.stdout.trim() !== '' && candidate.stdout.trim() === primary.stdout.trim()
}

export async function applyPendingHandoffSeed(
  primaryPath: string,
  workingPath: string,
  workspace: BoundWorkspaceResource,
) {
  if (
    workspace.handoffSeedState !== 'pending' ||
    !workspace.handoffSeedRef ||
    !workspace.handoffSeedBaseRef
  ) {
    return
  }
  await applyWorkspaceHandoffSeed({
    projectPath: primaryPath,
    workingPath,
    sourceHead: workspace.handoffSeedBaseRef,
    snapshotRef: workspace.handoffSeedRef,
  })
}

export async function releaseAppliedHandoffSeed(
  primaryPath: string,
  workspace: BoundWorkspaceResource,
) {
  if (workspace.handoffSeedState !== 'pending' || !workspace.handoffSeedRef) return
  await releaseWorkspaceHandoffSeed(primaryPath, workspace.handoffSeedRef)
}
