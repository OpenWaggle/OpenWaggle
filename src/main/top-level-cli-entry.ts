import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { match, matchBy } from '@diegogbrisa/ts-match'
import { app } from 'electron'
import { startAppCliIfRequested } from './app-cli-entry'
import { flushCliOutput } from './cli-output-flush'
import { writeCliStdout, writeWritableChunk } from './cli-stdout'
import { env } from './env'
import { SESSION_CLI_EXIT } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'
import {
  type CliPathKind,
  routeTopLevelCli,
  type TopLevelCliCommand,
  type TopLevelCliEnvironment,
} from './top-level-cli-route'
import { topLevelCliUsage } from './top-level-cli-usage'

const SUCCESS_EXIT = SESSION_CLI_EXIT.SUCCESS

export type TopLevelCliLaunch =
  | { readonly kind: 'handled' }
  | { readonly kind: 'gui'; readonly openProjectPath?: string }

function pathKind(absolutePath: string): CliPathKind {
  try {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) return 'directory'
    return 'file'
  } catch {
    return 'missing'
  }
}

/** A launch from a directory that was since deleted must still reach the desktop app. */
function workingDirectory() {
  try {
    return process.cwd()
  } catch {
    return homedir()
  }
}

/** stderr can be a closed pipe too; that must not become an uncaught stream error. */
function writeStderr(text: string) {
  return writeWritableChunk(process.stderr, text)
}

function nodeEnvironment(): TopLevelCliEnvironment {
  return {
    workingDirectory: workingDirectory(),
    homeDirectory: homedir(),
    pathKind,
    isPackaged: app.isPackaged,
  }
}

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
function hideFromDock(platform: NodeJS.Platform) {
  if (platform === 'darwin') app.setActivationPolicy('accessory')
}

/** A reader that stopped reading must not keep a finished command running. */
const EXIT_FLUSH_TIMEOUT_MS = 2_000

async function exitAfterOutput(exitCode: number) {
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

function ignoreOutputStreamErrors() {
  if (ignoringOutputStreamErrors) return
  ignoringOutputStreamErrors = true
  const ignore = () => undefined
  process.stdout.on('error', ignore)
  process.stderr.on('error', ignore)
}

function writeAndExit(write: () => Promise<void> | void, exitCode: number) {
  void Promise.resolve()
    .then(write)
    .then(
      () => exitAfterOutput(exitCode),
      (error: unknown) => {
        if (isBrokenPipe(error)) return exitAfterOutput(exitCode)
        return writeStderr(`error: ${errorMessage(error)}\n`)
          .catch(() => undefined)
          .then(() => exitAfterOutput(SESSION_CLI_EXIT.FAILURE))
      },
    )
}

async function runCommand(command: TopLevelCliCommand, argv: readonly string[]) {
  return match(command)
    .with('run', async () => (await import('./run-cli')).runRunCli(argv))
    .with('status', async () => (await import('./status-cli')).runStatusCli(argv))
    .with('host', async () => (await import('./host-cli')).runHostCli(argv))
    .exhaustive()
}

function startCommand(command: TopLevelCliCommand, argv: readonly string[]) {
  const fail = async (error: unknown) => {
    await writeStderr(`error: ${errorMessage(error)}\n`).catch(() => undefined)
    await exitAfterOutput(SESSION_CLI_EXIT.FAILURE)
  }
  try {
    configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  } catch (error) {
    void fail(error)
    return
  }
  void app
    .whenReady()
    .then(() => runCommand(command, argv))
    .then(exitAfterOutput)
    .catch(fail)
}

/**
 * Route one invocation. Help, version, and usage errors are answered before Electron is
 * ready, so they never start the desktop app or show a Dock icon.
 */
export function startTopLevelCli(
  argv: readonly string[],
  environment: TopLevelCliEnvironment = nodeEnvironment(),
  platform: NodeJS.Platform = process.platform,
): TopLevelCliLaunch {
  const route = routeTopLevelCli(argv, environment)
  if (route.kind !== 'gui' && route.kind !== 'open-project') {
    hideFromDock(platform)
    ignoreOutputStreamErrors()
  }
  const handled = { kind: 'handled' } as const
  return matchBy(route, 'kind')
    .with('gui', (): TopLevelCliLaunch => ({ kind: 'gui' }))
    .with(
      'open-project',
      (route): TopLevelCliLaunch => ({
        kind: 'gui',
        openProjectPath: route.projectPath,
      }),
    )
    .with('help', () => {
      writeAndExit(() => writeCliStdout(`${topLevelCliUsage(app.getVersion())}\n`), SUCCESS_EXIT)
      return handled
    })
    .with('version', () => {
      writeAndExit(() => writeCliStdout(`${app.getVersion()}\n`), SUCCESS_EXIT)
      return handled
    })
    .with('usage-error', (route) => {
      writeAndExit(
        () =>
          writeStderr(`openwaggle: ${route.message}\n\n${topLevelCliUsage(app.getVersion())}\n`),
        SESSION_CLI_EXIT.USAGE,
      )
      return handled
    })
    .with('command', (route) => {
      startCommand(route.command, route.argv)
      return handled
    })
    .with('delegate', (route) => {
      if (!startAppCliIfRequested(route.argv)) {
        writeAndExit(
          () => writeStderr(`openwaggle: unknown command '${route.argv[0] ?? ''}'.\n`),
          SESSION_CLI_EXIT.USAGE,
        )
      }
      return handled
    })
    .exhaustive()
}
