import { dialog } from 'electron'
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
