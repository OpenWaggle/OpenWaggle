import { app } from 'electron'
import { CLI_EXIT } from './cli-error'
import { flushCliOutput } from './cli-output-flush'

/** A reader that stopped reading must not keep a finished command running. */
const EXIT_FLUSH_TIMEOUT_MS = 2_000

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** A reader that went away (`openwaggle --help | head -1`) is not a failure worth reporting. */
function isBrokenPipe(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPIPE'
}

/**
 * Commands run without a window. On macOS the Electron app would otherwise register as a
 * regular app and show a Dock icon for as long as the command runs.
 */
export function hideCliFromDock(platform: NodeJS.Platform) {
  if (platform === 'darwin') app.setActivationPolicy('accessory')
}

export async function exitAfterCliOutput(exitCode: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    flushCliOutput().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, EXIT_FLUSH_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer)
  app.exit(exitCode)
}

/**
 * A closed pipe (`openwaggle run … 2>&1 | head`) reports EPIPE as a stream `error` event.
 * Unhandled, Electron shows a main-process error dialog, so commands ignore stream errors.
 */
let ignoringOutputStreamErrors = false

export function ignoreCliOutputStreamErrors() {
  if (ignoringOutputStreamErrors) return
  ignoringOutputStreamErrors = true
  const ignore = () => undefined
  process.stdout.on('error', ignore)
  process.stderr.on('error', ignore)
}

/** Writes a command's output, then exits with its code once the output has drained. */
export function writeCliOutputAndExit(
  write: () => Promise<void> | void,
  exitCode: number,
  writeStderr: (text: string) => Promise<void>,
) {
  void Promise.resolve()
    .then(write)
    .then(
      () => exitAfterCliOutput(exitCode),
      (error: unknown) => {
        if (isBrokenPipe(error)) return exitAfterCliOutput(exitCode)
        return writeStderr(`error: ${errorMessage(error)}\n`)
          .catch(() => undefined)
          .then(() => exitAfterCliOutput(CLI_EXIT.FAILURE))
      },
    )
}
