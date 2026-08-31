import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface SessionWorkspaceResource {
  readonly id: string
  readonly projectPath: string
  readonly kind: 'local' | 'managed-worktree'
  readonly workingPath: string
  readonly worktreeBranch: string | null
}

export interface ManagedWorktreeRemovalCandidate {
  readonly id: string
  readonly projectPath: string
  readonly workingPath: string
}

export type ManagedWorktreeRemovalAdmission =
  | {
      readonly status: 'reserved'
      readonly resourceId: string
      readonly createdReservation: boolean
    }
  | { readonly status: 'unavailable' }

export interface SessionWorkspaceResourceRepositoryShape {
  readonly getBound: (sessionId: SessionId) => Effect.Effect<SessionWorkspaceResource | null, Error>
  readonly countManagedWorktreeBindings: (input: {
    readonly projectPath: string
    readonly workingPath: string
  }) => Effect.Effect<number, Error>
  readonly listManagedWorktreeRemovalCandidates: () => Effect.Effect<
    readonly ManagedWorktreeRemovalCandidate[],
    Error
  >
  readonly admitManagedWorktreeRemoval: (input: {
    readonly resourceId?: string
    readonly reservationId: string
    readonly projectPath: string
    readonly workingPath: string
  }) => Effect.Effect<ManagedWorktreeRemovalAdmission, Error>
  readonly finalizeManagedWorktreeRemoval: (input: {
    readonly resourceId: string
    readonly createdReservation: boolean
    readonly removed: boolean
  }) => Effect.Effect<void, Error>
}

export class SessionWorkspaceResourceRepository extends Context.Tag(
  '@openwaggle/SessionWorkspaceResourceRepository',
)<SessionWorkspaceResourceRepository, SessionWorkspaceResourceRepositoryShape>() {}
