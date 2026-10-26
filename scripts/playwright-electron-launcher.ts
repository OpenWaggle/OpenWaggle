import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

interface PlaywrightElectronLaunchInput {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly cwd?: string
  readonly appPath?: string
  readonly executablePath?: string
  /** A scratch HOME for the app; defaults to `<userDataDir>/home`. */
  readonly homeDir?: string
  /** A scratch Pi agent directory; defaults to `<home>/.pi/agent`. */
  readonly piAgentDir?: string
  /** Test-only child environment overrides applied after the safe inherited baseline. */
  readonly environment?: Readonly<Record<string, string>>
}

/** The app's home inside its scratch profile, unless the caller chose another scratch one. */
const SCRATCH_HOME_DIRECTORY = 'home'

export function playwrightElectronHome(input: {
  readonly userDataDir: string
  readonly homeDir?: string
  readonly piAgentDir?: string
}) {
  const home = input.homeDir ?? path.join(input.userDataDir, SCRATCH_HOME_DIRECTORY)
  return { home, piAgentDir: input.piAgentDir ?? path.join(home, '.pi', 'agent') }
}

/**
 * The app's environment. HOME, the Pi agent directory and user data are always scratch
 * directories: overriding user data alone still migrates the real `~/.openwaggle` and
 * `~/.pi/agent` files, and reads the user's global MCP servers and Pi sign-ins.
 */
export function buildPlaywrightElectronEnvironment(input: {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly homeDir?: string
  readonly piAgentDir?: string
  readonly environment?: Readonly<Record<string, string>>
}) {
  const home = playwrightElectronHome(input)
  const appControls = {
    HOME: home.home,
    USERPROFILE: home.home,
    PI_CODING_AGENT_DIR: home.piAgentDir,
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: input.userDataDir,
    ...(input.hidden ? { OPENWAGGLE_AUTOMATION: '1' } : {}),
  }
  return {
    ...buildSafeElectronEnvironment(appControls),
    ...input.environment,
    // A fixture may change its shell startup environment, but never the app's
    // automation, home or storage authority.
    ...appControls,
  }
}

/**
 * Chromium's mock keychain (and Linux's basic password store) keeps the app, and the Session
 * Host it forwards the switches to, off the user's real credential store. With a scratch HOME,
 * macOS `safeStorage` otherwise blocks looking for a login keychain there.
 */
export function playwrightElectronArguments(
  input: Pick<PlaywrightElectronLaunchInput, 'appPath' | 'executablePath'>,
  platform: NodeJS.Platform = process.platform,
) {
  const credentialStoreSwitches = [
    '--use-mock-keychain',
    ...(platform === 'linux' ? ['--password-store=basic'] : []),
  ]
  const appPath =
    input.appPath === undefined && input.executablePath !== undefined
      ? []
      : [input.appPath ?? '.']
  return [...appPath, ...credentialStoreSwitches]
}

export async function launchOpenWaggleElectron(
  input: PlaywrightElectronLaunchInput,
): Promise<ElectronApplication> {
  // Tools the app starts expect the home and Pi agent directories to exist.
  await fs.mkdir(playwrightElectronHome(input).piAgentDir, { recursive: true })
  return electron.launch({
    args: playwrightElectronArguments(input),
    ...(input.executablePath === undefined
      ? {}
      : { executablePath: input.executablePath }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: buildPlaywrightElectronEnvironment(input),
  })
}
