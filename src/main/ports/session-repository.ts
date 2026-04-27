import type { MessageRole } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionNodeKind,
  SessionSummary,
  SessionTree,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'

export interface ProjectedSessionNodeInput {
  readonly id: string
  readonly parentId: string | null
  readonly piEntryType: string
  readonly kind: SessionNodeKind
  readonly role: MessageRole | null
  readonly timestampMs: number
  readonly contentJson: string
  readonly metadataJson: string
  readonly pathDepth: number
  readonly createdOrder: number
}

export interface PersistSessionSnapshotInput {
  readonly sessionId: SessionId
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeNodeId: string | null
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly waggleConfig?: WaggleConfig
}

export interface UpdateSessionRuntimeInput {
  readonly sessionId: SessionId
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

export interface SessionRepositoryShape {
  readonly list: (
    limit?: number,
  ) => Effect.Effect<readonly SessionSummary[], SessionProjectionRepositoryError>
  readonly getTree: (
    sessionId: SessionId,
  ) => Effect.Effect<SessionTree | null, SessionProjectionRepositoryError>
  readonly getWorkspace: (
    sessionId: SessionId,
    selection?: SessionWorkspaceSelection,
  ) => Effect.Effect<SessionWorkspace | null, SessionProjectionRepositoryError>
  readonly persistSnapshot: (
    input: PersistSessionSnapshotInput,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly updateRuntime: (
    input: UpdateSessionRuntimeInput,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
}

export class SessionRepository extends Context.Tag('@openwaggle/SessionRepository')<
  SessionRepository,
  SessionRepositoryShape
>() {}
