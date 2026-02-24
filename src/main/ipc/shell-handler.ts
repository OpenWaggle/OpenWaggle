import { app, shell } from 'electron'
import { typedHandle } from './typed-ipc'

export function registerShellHandlers(): void {
  typedHandle('app:open-logs-dir', () => {
    shell.openPath(app.getPath('logs'))
  })

  typedHandle('app:get-logs-path', () => {
    return app.getPath('logs')
  })
}
