import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AppPathManager, configureAppStoragePaths } from '../session-data'

const SESSION_DATA_DIRECTORY_NAME = 'session-data'
const REPAIR_MARKER_FILENAME = '.openwaggle-dips-repair-v1'
const DIPS_FILENAMES = ['DIPS', 'DIPS-wal', 'DIPS-shm'] as const

const tempDirectories: string[] = []

function createTempDirectory(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'openwaggle-session-data-'))
  tempDirectories.push(tempDirectory)
  return tempDirectory
}

function createAppPathManager(defaultUserDataPath: string): {
  readonly appPathManager: AppPathManager
  readonly getRecordedPath: (name: 'userData' | 'sessionData') => string | undefined
} {
  const recordedPaths = new Map<'userData' | 'sessionData', string>()

  return {
    appPathManager: {
      getPath(name) {
        if (name === 'userData') {
          return defaultUserDataPath
        }

        throw new Error(`Unsupported path lookup: ${name}`)
      },
      setPath(name, value) {
        recordedPaths.set(name, value)
      },
    },
    getRecordedPath(name) {
      return recordedPaths.get(name)
    },
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
  it('creates userData and sessionData paths and records them on the app', () => {
    const userDataPath = createTempDirectory()
    const { appPathManager, getRecordedPath } = createAppPathManager(userDataPath)

    configureAppStoragePaths(appPathManager)

    const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
    expect(existsSync(userDataPath)).toBe(true)
    expect(existsSync(sessionDataPath)).toBe(true)
    expect(getRecordedPath('userData')).toBe(userDataPath)
    expect(getRecordedPath('sessionData')).toBe(sessionDataPath)
    expect(existsSync(join(sessionDataPath, REPAIR_MARKER_FILENAME))).toBe(true)
  })

  it('repairs existing Chromium DIPS files once for existing profiles', () => {
    const userDataPath = createTempDirectory()
    const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
    const { appPathManager } = createAppPathManager(userDataPath)

    mkdirSync(sessionDataPath, { recursive: true })
    for (const filename of DIPS_FILENAMES) {
      writeFileSync(join(sessionDataPath, filename), 'corrupt')
    }

    configureAppStoragePaths(appPathManager)

    for (const filename of DIPS_FILENAMES) {
      expect(existsSync(join(sessionDataPath, filename))).toBe(false)
    }
    expect(existsSync(join(sessionDataPath, REPAIR_MARKER_FILENAME))).toBe(true)
  })

  it('does not delete Chromium DIPS files again after the one-time repair marker exists', () => {
    const userDataPath = createTempDirectory()
    const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
    const { appPathManager } = createAppPathManager(userDataPath)

    configureAppStoragePaths(appPathManager)

    const preservedDipsPath = join(sessionDataPath, 'DIPS')
    writeFileSync(preservedDipsPath, 'healthy')

    configureAppStoragePaths(appPathManager)

    expect(existsSync(preservedDipsPath)).toBe(true)
  })
})
