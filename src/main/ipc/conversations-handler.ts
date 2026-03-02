import type { ConversationId } from '@shared/types/brand'
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
  typedHandle('conversations:list', async (_event, limit?: number) => {
    return listConversations(limit)
  })

  typedHandle('conversations:get', async (_event, id: ConversationId) => {
    return getConversation(id)
  })

  typedHandle('conversations:create', async (_event, projectPath: string | null) => {
    return createConversation(projectPath)
  })

  typedHandle('conversations:delete', async (_event, id: ConversationId) => {
    cleanupConversationRun(id)
    await deleteConversation(id)
  })

  typedHandle('conversations:archive', async (_event, id: ConversationId) => {
    cleanupConversationRun(id)
    await archiveConversation(id)
  })

  typedHandle('conversations:unarchive', async (_event, id: ConversationId) => {
    await unarchiveConversation(id)
  })

  typedHandle('conversations:list-archived', async () => {
    return listArchivedConversations()
  })

  typedHandle('conversations:update-title', async (_event, id: ConversationId, title: string) => {
    await updateConversationTitle(id, title)
  })

  typedHandle(
    'conversations:update-project-path',
    async (_event, id: ConversationId, projectPath: string | null) => {
      return updateConversationProjectPath(id, projectPath)
    },
  )
}
