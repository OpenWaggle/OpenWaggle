import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface SessionWorkspaceResource {
  readonly id: string
  readonly projectPath: string
  readonly kind: 'local' | 'managed-worktree'
  readonly workingPath: string
  readonly worktreeBranch: string | null
}

export interface SessionWorkspaceResourceRepositoryShape {
  readonly getBound: (sessionId: SessionId) => Effect.Effect<SessionWorkspaceResource | null, Error>
}

export class SessionWorkspaceResourceRepository extends Context.Tag(
  '@openwaggle/SessionWorkspaceResourceRepository',
)<SessionWorkspaceResourceRepository, SessionWorkspaceResourceRepositoryShape>() {}
