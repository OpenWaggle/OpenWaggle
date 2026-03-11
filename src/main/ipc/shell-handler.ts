import * as Effect from 'effect/Effect'
import { app, clipboard, shell } from 'electron'
import { createLogger } from '../logger'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('ipc:shell')

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:'])

export function registerShellHandlers(): void {
  typedHandle('app:open-logs-dir', () =>
    Effect.sync(() => {
      shell.openPath(app.getPath('logs'))
    }),
  )

  typedHandle('app:get-logs-path', () => Effect.sync(() => app.getPath('logs')))

  typedOn('clipboard:write-text', (_event, text) => Effect.sync(() => clipboard.writeText(text)))

  typedHandle('shell:open-external', (_event, url) =>
    Effect.gen(function* () {
      const parsed = new URL(url)
      if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
        logger.warn('blocked open-external with disallowed protocol', {
          protocol: parsed.protocol,
        })
        return yield* Effect.fail(new Error(`Disallowed URL protocol: ${parsed.protocol}`))
      }
      yield* Effect.promise(() => shell.openExternal(url))
    }),
  )
}
