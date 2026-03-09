import type { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listArchivedConversations,
  listConversations,
  unarchiveConversation,
  updateConversationProjectPath,
  updateConversationTitle,
} from '../store/conversations'
import { typedHandleEffect } from './typed-ipc'

export function registerConversationsHandlers(): void {
  typedHandleEffect('conversations:list', (_event, limit?: number) =>
    Effect.promise(() => listConversations(limit)),
  )

  typedHandleEffect('conversations:get', (_event, id: ConversationId) =>
    Effect.promise(() => getConversation(id)),
  )

  typedHandleEffect('conversations:create', (_event, projectPath: string | null) =>
    Effect.promise(() => createConversation(projectPath)),
  )

  typedHandleEffect('conversations:delete', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(Effect.promise(() => deleteConversation(id))),
    ),
  )

  typedHandleEffect('conversations:archive', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(Effect.promise(() => archiveConversation(id))),
    ),
  )

  typedHandleEffect('conversations:unarchive', (_event, id: ConversationId) =>
    Effect.promise(() => unarchiveConversation(id)),
  )

  typedHandleEffect('conversations:list-archived', () =>
    Effect.promise(() => listArchivedConversations()),
  )

  typedHandleEffect('conversations:update-title', (_event, id: ConversationId, title: string) =>
    Effect.promise(() => updateConversationTitle(id, title)),
  )

  typedHandleEffect(
    'conversations:update-project-path',
    (_event, id: ConversationId, projectPath: string | null) =>
      Effect.promise(() => updateConversationProjectPath(id, projectPath)),
  )
}
