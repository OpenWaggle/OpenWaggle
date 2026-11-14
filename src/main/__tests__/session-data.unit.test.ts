import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AppStoragePaths, configureAppStoragePaths } from '../session-data'
import {
  configureSessionScratchNamespace,
  sessionScratchRoot,
} from '../utils/session-scratch-directory'

const SESSION_DATA_DIRECTORY_NAME = 'session-data'

const tempDirectories: string[] = []

function createTempDirectory() {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'openwaggle-session-data-'))
  tempDirectories.push(tempDirectory)
  return tempDirectory
}

function createAppPathManager(defaultUserDataPath: string) {
  const recordedPaths = new Map<'userData' | 'sessionData' | 'logs', string>()

  return {
    appPathManager: {
      userData: () => defaultUserDataPath,
      setUserData: (value) => recordedPaths.set('userData', value),
      setLogs: (value) => recordedPaths.set('logs', value),
      setWebProfileData: (value) => recordedPaths.set('sessionData', value),
    },
    getRecordedPath(name) {
      return recordedPaths.get(name)
    },
  } satisfies {
    readonly appPathManager: AppStoragePaths
    readonly getRecordedPath: (name: 'userData' | 'sessionData' | 'logs') => string | undefined
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((tempDirectory) => rm(tempDirectory, { force: true, recursive: true })),
  )
})

describe('configureAppStoragePaths', () => {
  it('gives the process the scratch namespace of this profile, as the Host computes it', () => {
    const userDataPath = createTempDirectory()
    const { appPathManager } = createAppPathManager(userDataPath)
    const restore = configureSessionScratchNamespace('/some/other/profile')
    try {
      configureAppStoragePaths(undefined, appPathManager)
      const configured = sessionScratchRoot('/base')
      configureSessionScratchNamespace(userDataPath)

      // The GUI and the Host both derive it from the user-data directory, so images captured by
      // either side come from the same scratch directory.
      expect(configured).toBe(sessionScratchRoot('/base'))
    } finally {
      restore()
    }
  })

  it('creates userData and sessionData paths and records them on the app', () => {
    const userDataPath = createTempDirectory()
    const { appPathManager, getRecordedPath } = createAppPathManager(userDataPath)

    configureAppStoragePaths(undefined, appPathManager)

    const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
    expect(existsSync(userDataPath)).toBe(true)
    expect(existsSync(sessionDataPath)).toBe(true)
    expect(getRecordedPath('userData')).toBe(userDataPath)
    expect(getRecordedPath('sessionData')).toBe(sessionDataPath)
  })

  // QA and test runs point OPENWAGGLE_USER_DATA_DIR at a scratch profile; Electron's logs, and the
  // Host's log file under them, must not land in the real ~/Library/Logs/<app> meanwhile.
  it('keeps the logs of an overridden profile inside it', () => {
    const userDataPath = createTempDirectory()
    const { appPathManager, getRecordedPath } = createAppPathManager('/default/profile')

    configureAppStoragePaths(userDataPath, appPathManager)

    expect(getRecordedPath('logs')).toBe(join(userDataPath, 'logs'))
  })

  it("leaves Electron's own logs location for the default profile", () => {
    const userDataPath = createTempDirectory()
    const { appPathManager, getRecordedPath } = createAppPathManager(userDataPath)

    configureAppStoragePaths(undefined, appPathManager)

    expect(getRecordedPath('logs')).toBeUndefined()
  })
})
