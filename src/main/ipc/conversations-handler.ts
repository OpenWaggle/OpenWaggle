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
import { typedHandle } from './typed-ipc'

export function registerConversationsHandlers(): void {
  typedHandle('conversations:list', (_event, limit?: number) =>
    Effect.promise(() => listConversations(limit)),
  )

  typedHandle('conversations:get', (_event, id: ConversationId) =>
    Effect.promise(() => getConversation(id)),
  )

  typedHandle('conversations:create', (_event, projectPath: string | null) =>
    Effect.promise(() => createConversation(projectPath)),
  )

  typedHandle('conversations:delete', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(Effect.promise(() => deleteConversation(id))),
    ),
  )

  typedHandle('conversations:archive', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(Effect.promise(() => archiveConversation(id))),
    ),
  )

  typedHandle('conversations:unarchive', (_event, id: ConversationId) =>
    Effect.promise(() => unarchiveConversation(id)),
  )

  typedHandle('conversations:list-archived', () =>
    Effect.promise(() => listArchivedConversations()),
  )

  typedHandle('conversations:update-title', (_event, id: ConversationId, title: string) =>
    Effect.promise(() => updateConversationTitle(id, title)),
  )

  typedHandle(
    'conversations:update-project-path',
    (_event, id: ConversationId, projectPath: string | null) =>
      Effect.promise(() => updateConversationProjectPath(id, projectPath)),
  )
}
