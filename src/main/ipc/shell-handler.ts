import { app, clipboard, shell } from 'electron'
import { createLogger } from '../logger'
import { safeHandle, typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('ipc:shell')

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:'])

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

  safeHandle('shell:open-external', async (_event, url) => {
    const parsed = new URL(url)
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      logger.warn('blocked open-external with disallowed protocol', { protocol: parsed.protocol })
      throw new Error(`Disallowed URL protocol: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  })
}
