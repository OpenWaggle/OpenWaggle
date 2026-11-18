import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { appPaths } from './desktop-shell/app-paths'
import type { AppPathsShape } from './ports/desktop-shell/app-paths'
import { configureSessionScratchNamespace } from './utils/session-scratch-directory'

const SESSION_DATA_DIRECTORY_NAME = 'session-data'
const LOGS_DIRECTORY_NAME = 'logs'

/** The part of `AppPaths` that places this process's profile. */
export type AppStoragePaths = Pick<
  AppPathsShape,
  'userData' | 'setUserData' | 'setLogs' | 'setWebProfileData'
>

export function configureAppStoragePaths(
  overrideUserDataPath?: string,
  paths: AppStoragePaths = appPaths,
) {
  const userDataPath = overrideUserDataPath ?? paths.userData()
  paths.setUserData(userDataPath)
  mkdirSync(userDataPath, { recursive: true })
  // An overridden profile (QA, tests, OPENWAGGLE_USER_DATA_DIR) keeps its logs too, the shell's
  // and the Session Host's file, instead of writing to the real ~/Library/Logs/<app>.
  if (overrideUserDataPath !== undefined) {
    paths.setLogs(join(userDataPath, LOGS_DIRECTORY_NAME))
  }
  // The GUI captures Session images from scratch directories too, so it must agree with the Host.
  configureSessionScratchNamespace(userDataPath)

  const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
  mkdirSync(sessionDataPath, { recursive: true })
  paths.setWebProfileData(sessionDataPath)
}
