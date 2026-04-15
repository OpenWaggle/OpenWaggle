/**
 * ConversationRepository port — domain-owned interface for conversation persistence.
 *
 * Replaces direct calls to `src/main/store/conversations.ts` functions.
 * Implemented by the SQLite adapter layer.
 */
import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { Context, type Effect } from 'effect'
import type { ConversationRepositoryError } from '../errors'

export interface ConversationRepositoryShape {
  readonly get: (id: ConversationId) => Effect.Effect<Conversation, ConversationRepositoryError>
  readonly save: (conversation: Conversation) => Effect.Effect<void, ConversationRepositoryError>
  readonly list: (
    limit?: number,
  ) => Effect.Effect<readonly ConversationSummary[], ConversationRepositoryError>
  readonly create: (
    projectPath: string | null,
  ) => Effect.Effect<Conversation, ConversationRepositoryError>
  readonly delete: (id: ConversationId) => Effect.Effect<void, ConversationRepositoryError>
  readonly archive: (id: ConversationId) => Effect.Effect<void, ConversationRepositoryError>
  readonly unarchive: (id: ConversationId) => Effect.Effect<void, ConversationRepositoryError>
  readonly listArchived: () => Effect.Effect<
    readonly ConversationSummary[],
    ConversationRepositoryError
  >
  readonly updateTitle: (
    id: ConversationId,
    title: string,
  ) => Effect.Effect<void, ConversationRepositoryError>
  readonly updateProjectPath: (
    id: ConversationId,
    projectPath: string | null,
  ) => Effect.Effect<void, ConversationRepositoryError>
  readonly updatePlanMode: (
    id: ConversationId,
    active: boolean,
  ) => Effect.Effect<void, ConversationRepositoryError>
  readonly updateCompactionGuidance: (
    id: ConversationId,
    guidance: string | null,
  ) => Effect.Effect<void, ConversationRepositoryError>
  readonly markMessagesAsCompacted: (
    id: ConversationId,
    messageIds: readonly string[],
  ) => Effect.Effect<void, ConversationRepositoryError>
}

export class ConversationRepository extends Context.Tag('@openwaggle/ConversationRepository')<
  ConversationRepository,
  ConversationRepositoryShape
>() {}
