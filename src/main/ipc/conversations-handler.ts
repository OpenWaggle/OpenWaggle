import type { ConversationId } from '@shared/types/brand'
import { ipcMain } from 'electron'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from '../store/conversations'

export function registerConversationsHandlers(): void {
  ipcMain.handle('conversations:list', async () => {
    return listConversations()
  })

  ipcMain.handle('conversations:get', async (_event, id: ConversationId) => {
    return getConversation(id)
  })

  ipcMain.handle('conversations:create', async (_event, projectPath: string | null) => {
    return createConversation(projectPath)
  })

  ipcMain.handle('conversations:delete', async (_event, id: ConversationId) => {
    await deleteConversation(id)
  })

  ipcMain.handle(
    'conversations:update-title',
    async (_event, id: ConversationId, title: string) => {
      await updateConversationTitle(id, title)
    },
  )
}
