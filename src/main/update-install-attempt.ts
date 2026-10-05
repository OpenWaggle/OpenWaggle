import { type FileHandle, open, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { describeError } from './error-description'
import { createLogger } from './logger'

/**
 * A record of the last Restart to update, kept across the restart so the next launch can tell
 * whether the update installed. macOS Squirrel and the Windows installer run after the app has
 * quit, so a failed install is otherwise silent: the old version simply starts again.
 */
const updateInstallAttemptSchema = Schema.Struct({
  fromVersion: Schema.String,
  toVersion: Schema.String,
  /** Epoch milliseconds. */
  attemptedAt: Schema.Number.pipe(Schema.finite()),
})

export type UpdateInstallAttempt = Schema.Schema.Type<typeof updateInstallAttemptSchema>

export type UpdateInstallOutcome =
  | { readonly type: 'installed'; readonly version: string }
  | { readonly type: 'failed'; readonly version: string; readonly message: string }

const ATTEMPT_FILE_NAME = 'update-install-attempt.json'
/** Squirrel.Mac keeps its log in a cache directory named after the app's bundle identifier. */
function shipItLogPath(bundleIdentifier: string) {
  return path.join(
    homedir(),
    'Library',
    'Caches',
    `${bundleIdentifier}.ShipIt`,
    'ShipIt_stderr.log',
  )
}
// ShipIt logs local wall-clock time; allow for clock rounding between the two processes.
const SHIPIT_LOG_SLOP_MS = 5_000
const SHIPIT_LOG_TAIL_BYTES = 64 * 1024
const SHIPIT_LINE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) ShipIt\[[^\]]*\] (.*)$/
const SHIPIT_APP_RUNNING = 'Aborting update attempt because there are'

const logger = createLogger('update-install-attempt')

function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT'
}

async function readOptionalFile(file: string, description: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) logger.warn(`Could not read ${description}`, describeError(error))
    return null
  }
}

function attemptPath(userDataDirectory: string) {
  return path.join(userDataDirectory, ATTEMPT_FILE_NAME)
}

function parseAttempt(text: string): UpdateInstallAttempt | null {
  let value: unknown
  try {
    value = parseJsonUnknown(text)
  } catch (error) {
    logger.warn('Ignoring an unreadable update install attempt', describeError(error))
    return null
  }
  const decoded = safeDecodeUnknown(updateInstallAttemptSchema, value)
  if (decoded.success) return decoded.data
  logger.warn('Ignoring an invalid update install attempt', { issues: decoded.issues })
  return null
}

export async function recordUpdateInstallAttempt(
  userDataDirectory: string,
  attempt: UpdateInstallAttempt,
): Promise<void> {
  try {
    await writeFile(attemptPath(userDataDirectory), `${JSON.stringify(attempt)}\n`, 'utf8')
  } catch (error) {
    // Only the explanation after a failed install depends on it; never block the install.
    logger.warn('Could not record the update install attempt', describeError(error))
  }
}

/** Reads and removes the last attempt, so each one is reported once. */
export async function takeUpdateInstallAttempt(
  userDataDirectory: string,
): Promise<UpdateInstallAttempt | null> {
  const file = attemptPath(userDataDirectory)
  const text = await readOptionalFile(file, 'the update install attempt')
  if (text === null) return null
  await rm(file, { force: true }).catch((error: unknown) => {
    logger.warn('Could not remove the update install attempt', describeError(error))
  })
  return parseAttempt(text)
}

/** Whether ShipIt refused the install after `since` because the app was still running. */
export function shipItRefusedWhileRunning(log: string, since: number): boolean {
  for (const line of log.split('\n')) {
    const match = SHIPIT_LINE.exec(line)
    if (!match) continue
    const [, year, month, day, hour, minute, second, millisecond, message] = match
    const loggedAt = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond),
    ).getTime()
    if (loggedAt + SHIPIT_LOG_SLOP_MS < since) continue
    if (message?.startsWith(SHIPIT_APP_RUNNING)) return true
  }
  return false
}

export function updateInstallOutcome(input: {
  readonly attempt: UpdateInstallAttempt
  readonly currentVersion: string
  readonly shipItLog: string | null
}): UpdateInstallOutcome {
  const { attempt } = input
  if (input.currentVersion !== attempt.fromVersion) {
    return { type: 'installed', version: input.currentVersion }
  }
  const stillRunning =
    input.shipItLog !== null && shipItRefusedWhileRunning(input.shipItLog, attempt.attemptedAt)
  return {
    type: 'failed',
    version: attempt.toVersion,
    message: stillRunning
      ? `Version ${attempt.toVersion} was not installed because OpenWaggle was still running: it was opened again before the update finished, or another OpenWaggle process was open, such as openwaggle mcp serve or a command in a terminal. Close it, then choose Restart to update again.`
      : `Version ${attempt.toVersion} did not finish installing. Restart to update to try again.`,
  }
}

/** The end of ShipIt's log, which only ever grows; the last attempt is at the end. */
async function readShipItLogTail(bundleIdentifier: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  let file: FileHandle | null = null
  try {
    file = await open(shipItLogPath(bundleIdentifier), 'r')
    const { size } = await file.stat()
    const length = Math.min(size, SHIPIT_LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, size - length)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (!isMissingFile(error))
      logger.warn('Could not read the macOS updater log', describeError(error))
    return null
  } finally {
    await file?.close().catch(() => undefined)
  }
}

/** Reports whether the last Restart to update installed; `null` when there was none. */
export async function settleUpdateInstallAttempt(input: {
  readonly userDataDirectory: string
  readonly currentVersion: string
  readonly bundleIdentifier: string
}): Promise<UpdateInstallOutcome | null> {
  const attempt = await takeUpdateInstallAttempt(input.userDataDirectory)
  if (!attempt) return null
  const outcome = updateInstallOutcome({
    attempt,
    currentVersion: input.currentVersion,
    shipItLog: await readShipItLogTail(input.bundleIdentifier),
  })
  if (outcome.type === 'installed') {
    logger.info('Update installed', { from: attempt.fromVersion, to: outcome.version })
  } else {
    logger.warn('Update did not install', {
      from: attempt.fromVersion,
      to: attempt.toVersion,
      reason: outcome.message,
    })
  }
  return outcome
}
