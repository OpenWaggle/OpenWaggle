import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { managedCliShimContent } from '../../src/main/services/cli-shim-content'
import { resolveLocalSessionHostPaths } from '../../src/main/session-host/local-session-paths'
import { type LiveQaLifecycleState, runLiveQaProfileLifecycle } from './live-session-orchestration-lifecycle'
import { electronExecutablePath, withoutRunAsNode } from '../run-electron-dev'
import type { RunProcessOptions } from './bounded-child-process'
import { launchGui, runJsonCli, waitForHost } from './live-session-orchestration-support'

/**
 * Starts the development app the way a contributor does, with `pnpm dev` (through cmd.exe on
 * Windows, as pnpm runs scripts there), on a throwaway profile and home folder, and checks that
 * its Session Host starts and answers the CLI. The app runs hidden (automation mode) with the mock
 * keychain, and the Host is drained and the profile removed afterwards.
 */

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOST_START_TIMEOUT_MS = 300_000
const HOST_ANSWER_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 500
const EXECUTABLE_FILE_MODE = 0o700
const DEV_CLI_SHIM = 'openwaggle-dev-cli'
const INHERITED_IDENTITY_PREFIX = /^(OPENWAGGLE|PI)_/iu

function electronSwitches(platform: NodeJS.Platform) {
  return ['--use-mock-keychain', ...(platform === 'linux' ? ['--password-store=basic'] : [])]
}

/** The command and arguments that run `pnpm dev` as a contributor's shell would. */
export function devAppLaunchCommand(
  platform: NodeJS.Platform = process.platform,
  commandProcessor: string | undefined = process.env['ComSpec'],
) {
  const pnpmArguments = ['dev', '--', ...electronSwitches(platform)]
  if (platform !== 'win32') return { command: 'pnpm', args: pnpmArguments }
  return {
    command: commandProcessor ?? 'cmd.exe',
    args: ['/d', '/s', '/c', ['pnpm', ...pnpmArguments].join(' ')],
  }
}

export function devAppEnvironment(
  userDataRoot: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const home = path.join(userDataRoot, 'home')
  // pnpm needs the caller's environment, but not an OpenWaggle or Pi Session's identity: an agent
  // shell's markers make the CLI refuse to run, and its user data folder is not this profile's.
  const inherited = Object.fromEntries(
    Object.entries(withoutRunAsNode(baseEnvironment)).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !INHERITED_IDENTITY_PREFIX.test(entry[0]),
    ),
  )
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: userDataRoot,
  }
}

/**
 * The development CLI is Electron run on the project. On Linux it goes through the managed shim,
 * which moves the CLI's output to a descriptor Electron does not write its own logs to.
 */
async function developmentCli(userDataRoot: string, platform: NodeJS.Platform) {
  const executable = electronExecutablePath(PROJECT_ROOT)
  const viaShim = platform === 'linux'
  if (viaShim) {
    const content = managedCliShimContent({
      platform,
      homeDirectory: userDataRoot,
      executablePath: executable,
      appPath: PROJECT_ROOT,
    })
    await fs.writeFile(path.join(userDataRoot, DEV_CLI_SHIM), content, { mode: EXECUTABLE_FILE_MODE })
  }
  const leading = [...(viaShim ? [] : [PROJECT_ROOT]), ...electronSwitches(platform)]
  const runCli: typeof runJsonCli = (command, env, args, options?: RunProcessOptions) =>
    runJsonCli(command, env, [...leading, ...args], options)
  return { executable: viaShim ? path.join(userDataRoot, DEV_CLI_SHIM) : executable, runCli }
}

async function exists(filePath: string) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  )
}

/** Waits for the database only a running Session Host creates, so the CLI cannot start one. */
async function waitForGuiStartedHost(
  databasePath: string,
  gui: NonNullable<LiveQaLifecycleState['gui']>,
) {
  const deadline = Date.now() + HOST_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (gui.child.exitCode !== null || gui.child.signalCode !== null) {
      throw new Error('`pnpm dev` exited before its Session Host started.')
    }
    if (await exists(databasePath)) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error('The development app did not start its Session Host in time.')
}

export async function verifyDevAppStartup(userDataRoot: string) {
  const state: LiveQaLifecycleState = { gui: null, guiLogs: [], passed: false }
  const platform = process.platform
  await runLiveQaProfileLifecycle({
    userDataRoot,
    state,
    run: async () => {
      const environment = devAppEnvironment(userDataRoot)
      await fs.mkdir(environment.HOME ?? userDataRoot, { recursive: true })
      const launch = devAppLaunchCommand(platform)
      state.gui = await launchGui(launch.command, environment, launch.args)
      state.guiLogs.push(state.gui.logs)
      await waitForGuiStartedHost(resolveLocalSessionHostPaths({ userDataRoot }).databasePath, state.gui)
      const cli = await developmentCli(userDataRoot, platform)
      await waitForHost(cli.executable, environment, {
        runCli: cli.runCli,
        timeoutMs: HOST_ANSWER_TIMEOUT_MS,
      })
      if (state.gui.child.exitCode !== null || state.gui.child.signalCode !== null) {
        throw new Error('`pnpm dev` exited while its Session Host was answering.')
      }
      state.passed = true
    },
  })
}

async function main() {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-dev-startup-'))
  await verifyDevAppStartup(userDataRoot)
  // Cleanup keeps only the drained Host's ownership lock, which nothing holds open any more.
  await fs.rm(userDataRoot, { recursive: true, force: true }).catch((error: unknown) => {
    console.warn(`Could not remove ${userDataRoot}:`, error)
  })
  console.log('development app startup smoke passed')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
