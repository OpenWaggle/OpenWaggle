import { match, matchBy } from '@diegogbrisa/ts-match'
import { app } from 'electron'
import { startAppCliIfRequested } from './app-cli-entry'
import { writeCliStdout, writeWritableChunk } from './cli-stdout'
import { env } from './env'
import { SESSION_CLI_EXIT } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'
import { topLevelCliAnswer } from './top-level-cli-answer'
import { nodeTopLevelCliEnvironment } from './top-level-cli-environment'
import {
  exitAfterCliOutput,
  hideCliFromDock,
  ignoreCliOutputStreamErrors,
  writeCliOutputAndExit,
} from './top-level-cli-exit'
import {
  routeTopLevelCli,
  type TopLevelCliCommand,
  type TopLevelCliEnvironment,
} from './top-level-cli-route'

export type TopLevelCliLaunch =
  | { readonly kind: 'handled' }
  | {
      readonly kind: 'gui'
      readonly openProjectPath?: string
      readonly openSessionLink?: string
    }

/** stderr can be a closed pipe too; that must not become an uncaught stream error. */
function writeStderr(text: string) {
  return writeWritableChunk(process.stderr, text)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function writeAndExit(write: () => Promise<void> | void, exitCode: number) {
  writeCliOutputAndExit(write, exitCode, writeStderr)
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
    await exitAfterCliOutput(SESSION_CLI_EXIT.FAILURE)
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
    .then(exitAfterCliOutput)
    .catch(fail)
}

/**
 * Route one invocation. Help, version, and usage errors are answered before Electron is
 * ready, so they never start the desktop app or show a Dock icon.
 */
export function startTopLevelCli(
  argv: readonly string[],
  environment: TopLevelCliEnvironment = nodeTopLevelCliEnvironment(app.isPackaged),
  platform: NodeJS.Platform = process.platform,
): TopLevelCliLaunch {
  const route = routeTopLevelCli(argv, environment)
  if (route.kind !== 'gui' && route.kind !== 'open-project' && route.kind !== 'open-session-link') {
    hideCliFromDock(platform)
    ignoreCliOutputStreamErrors()
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
    .with(
      'open-session-link',
      (route): TopLevelCliLaunch => ({ kind: 'gui', openSessionLink: route.link }),
    )
    .with('help', 'version', 'usage-error', (route) => {
      const answer = topLevelCliAnswer(route, app.getVersion())
      if (answer) {
        writeAndExit(
          () =>
            answer.stream === 'stdout' ? writeCliStdout(answer.text) : writeStderr(answer.text),
          answer.exitCode,
        )
      }
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
