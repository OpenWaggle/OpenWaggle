import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { isProjectToolCallTrusted, recordToolCallApproval } from '../config/project-config'
import { typedHandle } from './typed-ipc'

function createProjectFolderDialogOptions(): OpenDialogOptions {
  return {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  }
}

export function registerProjectHandlers(): void {
  typedHandle('project:select-folder', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = createProjectFolderDialogOptions()
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0] ?? null
  })

  typedHandle(
    'project-config:is-tool-call-trusted',
    async (_event, projectPath: string, toolName, rawArgs: string) => {
      return isProjectToolCallTrusted(projectPath, toolName, rawArgs)
    },
  )

  typedHandle(
    'project-config:record-tool-approval',
    async (_event, projectPath: string, toolName, rawArgs: string) => {
      await recordToolCallApproval(projectPath, toolName, rawArgs, 'tool-approval')
    },
  )

  typedHandle('dialog:confirm', async (_event, message: string, detail?: string) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      message,
      detail,
    })
    return result.response === 1
  })
}
