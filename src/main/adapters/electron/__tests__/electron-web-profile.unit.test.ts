import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareChromiumProfile } from '../electron-web-profile'

const REPAIR_MARKER_FILENAME = '.openwaggle-dips-repair-v1'
const DIPS_FILENAMES = ['DIPS', 'DIPS-wal', 'DIPS-shm'] as const

const tempDirectories: string[] = []

function createSessionDataDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'openwaggle-chromium-profile-'))
  tempDirectories.push(directory)
  return directory
}

function commandLine() {
  const switches = new Map<string, string | undefined>()
  return {
    switches,
    commandLine: {
      hasSwitch: (name: string) => switches.has(name),
      appendSwitch: (name: string, value?: string) => {
        switches.set(name, value)
      },
    },
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('prepareChromiumProfile', () => {
  it('points Chromium at the profile and records the one-time repair', () => {
    const sessionDataPath = createSessionDataDirectory()
    const recorded: string[] = []

    prepareChromiumProfile(
      sessionDataPath,
      (path) => recorded.push(path),
      commandLine().commandLine,
    )

    expect(recorded).toEqual([sessionDataPath])
    expect(existsSync(join(sessionDataPath, REPAIR_MARKER_FILENAME))).toBe(true)
  })

  it("bounds the profile's Chromium HTTP disk cache before the app is ready", () => {
    const { switches, commandLine: line } = commandLine()

    prepareChromiumProfile(createSessionDataDirectory(), () => undefined, line)

    expect(Number(switches.get('disk-cache-size'))).toBeGreaterThan(0)
  })

  it('repairs existing Chromium DIPS files once for existing profiles', () => {
    const sessionDataPath = createSessionDataDirectory()
    mkdirSync(sessionDataPath, { recursive: true })
    for (const filename of DIPS_FILENAMES) {
      writeFileSync(join(sessionDataPath, filename), 'corrupt')
    }

    prepareChromiumProfile(sessionDataPath, () => undefined, commandLine().commandLine)

    for (const filename of DIPS_FILENAMES) {
      expect(existsSync(join(sessionDataPath, filename))).toBe(false)
    }
    expect(existsSync(join(sessionDataPath, REPAIR_MARKER_FILENAME))).toBe(true)
  })

  it('does not delete Chromium DIPS files again after the one-time repair marker exists', () => {
    const sessionDataPath = createSessionDataDirectory()
    prepareChromiumProfile(sessionDataPath, () => undefined, commandLine().commandLine)
    const preservedDipsPath = join(sessionDataPath, 'DIPS')
    writeFileSync(preservedDipsPath, 'healthy')

    prepareChromiumProfile(sessionDataPath, () => undefined, commandLine().commandLine)

    expect(existsSync(preservedDipsPath)).toBe(true)
  })
})
