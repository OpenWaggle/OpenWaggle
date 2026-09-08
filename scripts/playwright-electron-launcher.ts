import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

interface PlaywrightElectronLaunchInput {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly cwd?: string
  readonly appPath?: string
  readonly executablePath?: string
  readonly piAgentDir?: string
}

export function buildPlaywrightElectronEnvironment(input: {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly piAgentDir?: string
}) {
  return buildSafeElectronEnvironment({
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: input.userDataDir,
    ...(input.hidden ? { OPENWAGGLE_AUTOMATION: '1' } : {}),
    ...(input.piAgentDir ? { PI_CODING_AGENT_DIR: input.piAgentDir } : {}),
  })
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
