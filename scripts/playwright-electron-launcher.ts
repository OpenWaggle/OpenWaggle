import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

interface PlaywrightElectronLaunchInput {
  readonly userDataDir: string
  readonly hidden: boolean
  readonly cwd?: string
}

export function buildPlaywrightElectronEnvironment(input: {
  readonly userDataDir: string
  readonly hidden: boolean
}) {
  return buildSafeElectronEnvironment({
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: input.userDataDir,
    ...(input.hidden ? { OPENWAGGLE_AUTOMATION: '1' } : {}),
  })
}

export function launchOpenWaggleElectron(
  input: PlaywrightElectronLaunchInput,
): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: buildPlaywrightElectronEnvironment(input),
  })
}
