/**
 * SessionProjectionRepository port — domain-owned interface for session read-model persistence.
 *
 * Exposes the current conversation-shaped UI projection over the canonical
 * session/node/branch tables. Runtime writes still go through SessionRepository.
 */
import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'

export interface SessionProjectionRepositoryShape {
  readonly get: (
    id: ConversationId,
  ) => Effect.Effect<Conversation, SessionProjectionRepositoryError>
  readonly getOptional: (
    id: ConversationId,
  ) => Effect.Effect<Conversation | null, SessionProjectionRepositoryError>
  readonly list: (
    limit?: number,
  ) => Effect.Effect<readonly ConversationSummary[], SessionProjectionRepositoryError>
  readonly listFull: (
    limit?: number,
  ) => Effect.Effect<readonly Conversation[], SessionProjectionRepositoryError>
  readonly create: (input: {
    readonly projectPath: string
    readonly piSessionId: string
    readonly piSessionFile?: string
  }) => Effect.Effect<Conversation, SessionProjectionRepositoryError>
  readonly delete: (id: ConversationId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly archive: (id: ConversationId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly unarchive: (id: ConversationId) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly listArchived: () => Effect.Effect<
    readonly ConversationSummary[],
    SessionProjectionRepositoryError
  >
  readonly updateTitle: (
    id: ConversationId,
    title: string,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
}

export class SessionProjectionRepository extends Context.Tag(
  '@openwaggle/SessionProjectionRepository',
)<SessionProjectionRepository, SessionProjectionRepositoryShape>() {}
