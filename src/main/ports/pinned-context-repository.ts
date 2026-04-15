/**
 * PinnedContextRepository port — domain-owned interface for pinned context persistence.
 *
 * Implemented by the SQLite adapter layer.
 */
import type { ConversationId } from '@shared/types/brand'
import type { PinnedItem, PinnedItemInput } from '@shared/types/context'
import { Context, type Effect } from 'effect'

export interface PinnedContextRepositoryShape {
  readonly list: (conversationId: ConversationId) => Effect.Effect<PinnedItem[], Error>
  readonly add: (
    conversationId: ConversationId,
    item: PinnedItemInput,
  ) => Effect.Effect<PinnedItem, Error>
  readonly remove: (conversationId: ConversationId, pinId: string) => Effect.Effect<void, Error>
  readonly removeByMessageId: (
    conversationId: ConversationId,
    messageId: string,
  ) => Effect.Effect<void, Error>
  readonly getTokenEstimate: (conversationId: ConversationId) => Effect.Effect<number, Error>
}

export class PinnedContextRepository extends Context.Tag('@openwaggle/PinnedContextRepository')<
  PinnedContextRepository,
  PinnedContextRepositoryShape
>() {}
