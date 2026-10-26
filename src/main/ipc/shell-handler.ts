import { stat } from 'node:fs/promises'
import path from 'node:path'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { resolveUsageStatisticsEnvironmentBlock } from '@shared/usage-statistics/enablement'
import * as Effect from 'effect/Effect'
import { app, clipboard } from 'electron'
import {
  getDesktopNativeAdmissionIssue,
  recoverDesktopNativeAdmission,
} from '../desktop-native-admission'
import { AutomationDesktopUiError, openExternal, openPath, revealPath } from '../desktop-ui'
import { env } from '../env'
import { createLogger } from '../logger'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('ipc:shell')

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:'])

/*
 * What a failed Open, Reveal, or Open link says (#356). Electron's own reasons ("Failed to open
 * path", "Invalid URL") reach the renderer as the whole message, so each failure is mapped here to
 * words the user can act on, and the system's reason goes to the log. A non-disruptive automation
 * block keeps its own message: it is what QA needs to see.
 */
const NO_PATH_TO_OPEN = 'There is no file to open.'
const NO_PATH_TO_REVEAL = 'There is no file to reveal.'
const NOT_A_WEB_ADDRESS = 'This link is not a valid web address.'
const NOT_A_WEB_LINK = 'OpenWaggle opens only http and https links in your browser.'
const BROWSER_REFUSED = "Couldn't open the link in your browser."

function missingPathMessage(targetPath: string) {
  return `${path.basename(targetPath)} isn't there anymore. It may have been moved or deleted.`
}

function unrevealedPathMessage(targetPath: string) {
  return `Couldn't show ${path.basename(targetPath)} in its folder.`
}

function unopenedPathMessage(targetPath: string) {
  return `Couldn't open ${path.basename(targetPath)}. No app on this computer opened it.`
}

/** Fails with the user's message when nothing exists at `targetPath`. */
function requireExistingPath(targetPath: string) {
  return Effect.tryPromise(() => stat(targetPath)).pipe(
    Effect.asVoid,
    Effect.mapError(() => new Error(missingPathMessage(targetPath))),
  )
}

/** A rejected native call as the user's message, unless automation blocked it on purpose. */
function userFacingFailure(cause: unknown, message: string, context: Record<string, string>) {
  if (cause instanceof AutomationDesktopUiError) return cause
  logger.warn('A desktop shell action failed', {
    ...context,
    reason: cause instanceof Error ? cause.message : String(cause),
  })
  return new Error(message)
}

function parsedWebUrl(url: string) {
  return Effect.try({
    try: () => new URL(url),
    catch: () => new Error(NOT_A_WEB_ADDRESS),
  })
}

export function registerShellHandlers(): void {
  typedHandle('app:open-logs-dir', () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => openPath(app.getPath('logs')))
      if (result) return yield* Effect.fail(new Error(result))
    }),
  )

  typedHandle('app:get-logs-path', () => Effect.sync(() => app.getPath('logs')))
  typedHandle('app:get-native-admission-issue', () => Effect.sync(getDesktopNativeAdmissionIssue))
  // The window's own build and environment opt-out, for the Settings switch (#356).
  typedHandle('app:get-usage-statistics-block', () =>
    Effect.sync(() =>
      resolveUsageStatisticsEnvironmentBlock({
        buildChannel: BUILD_CHANNEL,
        env: {
          DO_NOT_TRACK: env.DO_NOT_TRACK,
          PI_TELEMETRY: env.PI_TELEMETRY,
          CI: env.CI,
          OPENWAGGLE_AUTOMATION: env.OPENWAGGLE_AUTOMATION,
        },
      }),
    ),
  )
  // Choosing Recover is the user's attestation that the previous window left nothing running.
  typedHandle('app:recover-native-admission', () =>
    Effect.promise(() => recoverDesktopNativeAdmission()),
  )

  typedOn('clipboard:write-text', (_event, text) => Effect.sync(() => clipboard.writeText(text)))

  typedHandle('clipboard:read-text', () => Effect.sync(() => clipboard.readText()))

  typedHandle('shell:open-path', (_event, targetPath) =>
    Effect.gen(function* () {
      const trimmedPath = targetPath.trim()
      if (!trimmedPath) return yield* Effect.fail(new Error(NO_PATH_TO_OPEN))
      yield* requireExistingPath(trimmedPath)
      const result = yield* Effect.tryPromise({
        try: () => openPath(trimmedPath),
        catch: (cause) =>
          userFacingFailure(cause, unopenedPathMessage(trimmedPath), { channel: 'open-path' }),
      })
      if (result) {
        return yield* Effect.fail(
          userFacingFailure(new Error(result), unopenedPathMessage(trimmedPath), {
            channel: 'open-path',
          }),
        )
      }
    }),
  )

  typedHandle('shell:reveal-path', (_event, targetPath) =>
    Effect.gen(function* () {
      const trimmedPath = targetPath.trim()
      if (!trimmedPath) return yield* Effect.fail(new Error(NO_PATH_TO_REVEAL))
      yield* requireExistingPath(trimmedPath)
      yield* Effect.try({
        try: () => revealPath(trimmedPath),
        catch: (cause) =>
          userFacingFailure(cause, unrevealedPathMessage(trimmedPath), { channel: 'reveal-path' }),
      })
    }),
  )

  typedHandle('shell:open-external', (_event, url) =>
    Effect.gen(function* () {
      const parsed = yield* parsedWebUrl(url)
      if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
        logger.warn('blocked open-external with disallowed protocol', {
          protocol: parsed.protocol,
        })
        return yield* Effect.fail(new Error(NOT_A_WEB_LINK))
      }
      yield* Effect.tryPromise({
        try: () => openExternal(url),
        catch: (cause) => userFacingFailure(cause, BROWSER_REFUSED, { channel: 'open-external' }),
      })
    }),
  )
}
