import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { isDesktopInstanceProbe } from './desktop-instance-probe'
import { createLogger } from './logger'
import { requestOpenSessionLink } from './session-link-requests'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('open-project-requests')

/**
 * Sent with the single-instance lock so a running app can open the requested project or the
 * Session a link names. A launch carries at most one of them.
 */
const secondInstanceDataSchema = Schema.Struct({
  openProjectPath: Schema.optional(Schema.String),
  openSessionLink: Schema.optional(Schema.String),
})

/** Launches waiting for the renderer, oldest first; a few is plenty for quick repeats. */
const pendingProjectPaths: string[] = []
const PENDING_PROJECT_LIMIT = 8

/**
 * The same canonical form the folder picker stores: the native realpath restores the
 * on-disk letter case (`~/desktop` becomes `~/Desktop`), so one project never appears twice
 * in recent projects or keys its preferences under two paths.
 */
function canonicalDirectory(projectPath: string) {
  if (!path.isAbsolute(projectPath)) return null
  try {
    const resolved = realpathSync.native(projectPath)
    return statSync(resolved).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

/**
 * Remember a project the user asked to open from the command line and tell renderers to
 * take it. The renderer pulls the request, so one opened before its window has loaded is
 * not lost and a reload never opens it twice.
 */
export function requestOpenProject(projectPath: string) {
  const directory = canonicalDirectory(projectPath)
  if (!directory) {
    logger.warn('Ignoring a request to open a project that is not an absolute directory', {
      projectPath,
    })
    return
  }
  if (pendingProjectPaths.at(-1) !== directory) pendingProjectPaths.push(directory)
  if (pendingProjectPaths.length > PENDING_PROJECT_LIMIT) pendingProjectPaths.shift()
  broadcastToWindows('app:open-project-requested', null)
}

/** The oldest waiting request, or `null`; each request is handed out once. */
export function takeOpenProjectRequest() {
  return pendingProjectPaths.shift() ?? null
}

/**
 * Accept a project path or Session link forwarded by a second launch, and say whether that
 * launch should bring a window forward. A later launch reveals the app as the Dock icon does,
 * except for a link that is not a Session link, which is refused without raising a window
 * (ADR 0056).
 */
function acceptSecondInstanceData(additionalData: unknown) {
  if (additionalData === undefined || additionalData === null) return true
  const decoded = safeDecodeUnknown(secondInstanceDataSchema, additionalData)
  if (!decoded.success) {
    logger.warn('Ignoring unrecognized second-instance data')
    return true
  }
  if (decoded.data.openSessionLink !== undefined) {
    return requestOpenSessionLink(decoded.data.openSessionLink)
  }
  if (decoded.data.openProjectPath !== undefined) requestOpenProject(decoded.data.openProjectPath)
  return true
}

function secondInstanceData(input: {
  readonly openProjectPath: string | undefined
  readonly openSessionLink: string | undefined
}): Record<string, string> | undefined {
  if (input.openProjectPath) return { openProjectPath: input.openProjectPath }
  if (input.openSessionLink) return { openSessionLink: input.openSessionLink }
  return undefined
}

export interface AppInstanceHost {
  readonly requestSingleInstanceLock: (additionalData?: Record<string, string>) => boolean
  readonly on: (
    event: 'second-instance',
    listener: (
      event: unknown,
      argv: readonly string[],
      workingDirectory: string,
      additionalData: unknown,
    ) => void,
  ) => void
}

/**
 * Become the running app, or hand this launch to the one already running. A second launch
 * passes its project or Session link through the lock's data, so `openwaggle <path>` and a
 * Session link opened on Windows or Linux reach the open app.
 */
export function claimAppInstance(input: {
  readonly host: AppInstanceHost
  readonly openProjectPath?: string | undefined
  readonly openSessionLink?: string | undefined
  readonly singleInstance: boolean
  /** Bring a window to the front for a later launch, creating one if none is open. */
  readonly revealWindow: () => void
}): 'primary' | 'secondary' {
  if (input.singleInstance) {
    const data = secondInstanceData({
      openProjectPath: input.openProjectPath,
      openSessionLink: input.openSessionLink,
    })
    if (!input.host.requestSingleInstanceLock(data)) return 'secondary'
    input.host.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
      // `openwaggle update` probes whether the app is running; it must not raise a window.
      if (isDesktopInstanceProbe(additionalData)) return
      if (acceptSecondInstanceData(additionalData)) input.revealWindow()
    })
  }
  if (input.openProjectPath) requestOpenProject(input.openProjectPath)
  if (input.openSessionLink) requestOpenSessionLink(input.openSessionLink)
  return 'primary'
}
