import type { ConversationId } from '@shared/types/brand'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationProjectPath,
  updateConversationTitle,
} from '../store/conversations'
import { typedHandle } from './typed-ipc'

export function registerConversationsHandlers(): void {
  typedHandle('conversations:list', async () => {
    return listConversations()
  })

  typedHandle('conversations:get', async (_event, id: ConversationId) => {
    return getConversation(id)
  })

  typedHandle('conversations:create', async (_event, projectPath: string | null) => {
    return createConversation(projectPath)
  })

  typedHandle('conversations:delete', async (_event, id: ConversationId) => {
    await deleteConversation(id)
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
