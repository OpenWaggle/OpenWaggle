import { app, clipboard, shell } from 'electron'
import { typedHandle, typedOn } from './typed-ipc'

export function registerShellHandlers(): void {
  typedHandle('app:open-logs-dir', () => {
    shell.openPath(app.getPath('logs'))
  })

  typedHandle('app:get-logs-path', () => {
    return app.getPath('logs')
  })

  typedOn('clipboard:write-text', (_event, text) => {
    clipboard.writeText(text)
  })
}
