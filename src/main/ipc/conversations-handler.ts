import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { ipcMain } from 'electron'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from '../store/conversations'

export function registerConversationsHandlers(): void {
  ipcMain.handle('conversations:list', () => {
    return listConversations()
  })

  ipcMain.handle('conversations:get', (_event, id: ConversationId) => {
    return getConversation(id)
  })

  ipcMain.handle(
    'conversations:create',
    (_event, model: SupportedModelId, projectPath: string | null) => {
      return createConversation(model, projectPath)
    },
  )

  ipcMain.handle('conversations:delete', (_event, id: ConversationId) => {
    deleteConversation(id)
  })

  ipcMain.handle('conversations:update-title', (_event, id: ConversationId, title: string) => {
    updateConversationTitle(id, title)
  })
}
