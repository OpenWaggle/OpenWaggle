import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

interface PlaywrightElectronLaunchInput {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly cwd?: string
  readonly appPath?: string
  readonly executablePath?: string
  readonly piAgentDir?: string
  /** Test-only child environment overrides applied after the safe inherited baseline. */
  readonly environment?: Readonly<Record<string, string>>
}

export function buildPlaywrightElectronEnvironment(input: {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly piAgentDir?: string
  readonly environment?: Readonly<Record<string, string>>
}) {
  const appControls = {
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: input.userDataDir,
    ...(input.hidden ? { OPENWAGGLE_AUTOMATION: '1' } : {}),
    ...(input.piAgentDir ? { PI_CODING_AGENT_DIR: input.piAgentDir } : {}),
  }
  return {
    ...buildSafeElectronEnvironment(appControls),
    ...input.environment,
    // A fixture may change its shell startup environment, but never the app's
    // automation or storage authority.
    ...appControls,
  }
}

export function launchOpenWaggleElectron(
  input: PlaywrightElectronLaunchInput,
): Promise<ElectronApplication> {
  return electron.launch({
    ...(input.appPath === undefined && input.executablePath !== undefined
      ? {}
      : { args: [input.appPath ?? '.'] }),
    ...(input.executablePath === undefined
      ? {}
      : { executablePath: input.executablePath }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: buildPlaywrightElectronEnvironment(input),
  })
}
