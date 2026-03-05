import { dialog } from 'electron'
import { isProjectToolCallTrusted, recordToolCallApproval } from '../config/project-config'
import { typedHandle } from './typed-ipc'

export function registerProjectHandlers(): void {
  typedHandle('project:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })

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
