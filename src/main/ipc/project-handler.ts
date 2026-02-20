import { dialog, ipcMain } from 'electron'

export function registerProjectHandlers(): void {
  ipcMain.handle('project:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:confirm', async (_event, message: string, detail?: string) => {
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
