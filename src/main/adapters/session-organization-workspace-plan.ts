import { randomUUID } from 'node:crypto'
import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionHandoffWorkspaceSelection } from '@shared/types/session-organization'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import type { PreparedWorkspaceHandoff } from '../ports/session-workspace-handoff-service'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'

export interface ResolveHandoffWorkspaceInput {
  readonly sessionId: string
  readonly projectPath: string
  readonly workspace: SessionHandoffWorkspaceSelection
  readonly now: number
  readonly preparedHandoff?: PreparedWorkspaceHandoff
}

function deferredHandoff(prepared?: PreparedWorkspaceHandoff) {
  return prepared?.transfer === 'deferred-new-worktree' ? prepared : undefined
}

export function newWorkspacePlan(input: ResolveHandoffWorkspaceInput) {
  const prepared = deferredHandoff(input.preparedHandoff)
  return matchBy(input.workspace, 'mode')
    .with('local', () => ({
      id: `workspace-${randomUUID()}`,
      kind: 'local' as const,
      workingPath: input.projectPath,
      lifecycleState: 'ready' as const,
      worktreeBranch: null,
      worktreeBaseRef: null,
      seedRef: null,
      seedBaseRef: null,
      seedState: 'none' as const,
      startFromOrigin: 0,
    }))
    .with('new-worktree', (workspace) => {
      const id = prepared?.workspaceId ?? `workspace-${randomUUID()}`
      const seedRef = prepared?.snapshotRef ?? null
      const seedBaseRef = prepared?.sourceHead ?? null
      return {
        id,
        kind: 'managed-worktree' as const,
        workingPath: prepared?.workingPath ?? resolveWorkspaceWorktreePath(input.projectPath, id),
        lifecycleState: 'pending' as const,
        worktreeBranch: prepared?.worktreeBranch ?? sessionWorktreeBranchForId(id),
        worktreeBaseRef: seedBaseRef ?? workspace.baseRef ?? null,
        seedRef,
        seedBaseRef,
        seedState: seedRef ? ('pending' as const) : ('none' as const),
        startFromOrigin: workspace.startFromOrigin === true ? 1 : 0,
      }
    })
    .with('existing', () => {
      throw new Error('An existing Workspace must be loaded rather than planned.')
    })
    .exhaustive()
}
