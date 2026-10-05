import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HDIUTIL_ATTACH_LOG, RUNNER_OFFLINE_LOG } from './macos-build-failure-fixtures'

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-build-failure-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('macOS build failure CLI', () => {
  function runCli(...args: string[]) {
    return spawnSync(process.execPath, ['scripts/macos-build-failure.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
  }

  function writeLog(contents: string) {
    const logPath = path.join(temporaryDirectory(), 'electron-builder-mac.log')
    fs.writeFileSync(logPath, contents)
    return logPath
  }

  it('prints the reason and exits 0 for a transient runner failure', () => {
    const result = runCli(writeLog(HDIUTIL_ATTACH_LOG))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('hdiutil hit a runner device error while building the DMG\n')
    expect(runCli(writeLog(RUNNER_OFFLINE_LOG)).stdout).toBe(
      'Notarization lost its connection to Apple\n',
    )
  })

  it('exits 1 without a reason for any other failure', () => {
    const result = runCli(writeLog('⨯ The identity is not valid for code signing'))
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('exits 1 with usage when the log path is missing', () => {
    const result = runCli()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: node scripts/macos-build-failure.ts')
  })
})

type ExecDmgbuildWithRetry = (
  file: string,
  args: readonly string[],
  artifactPath: string,
  options: object,
  baseDelayMs: number,
) => Promise<string>

/** Loads the retry helper from the patched dmg-builder that electron-builder actually uses. */
function loadExecDmgbuildWithRetry(): ExecDmgbuildWithRetry {
  const rootRequire = createRequire(import.meta.url)
  const electronBuilderRequire = createRequire(rootRequire.resolve('electron-builder/package.json'))
  const appBuilderRequire = createRequire(
    electronBuilderRequire.resolve('app-builder-lib/package.json'),
  )
  const dmgUtil: unknown = appBuilderRequire('dmg-builder/out/dmgUtil')
  const candidate: unknown = Reflect.get(Object(dmgUtil), 'execDmgbuildWithRetry')
  if (typeof candidate !== 'function') {
    throw new Error('The installed dmg-builder is missing the OpenWaggle retry patch.')
  }
  return async (...args) => String(await Reflect.apply(candidate, undefined, args))
}

// The shim is a POSIX shell script, and the patched helper only runs on macOS release builds.
describe.skipIf(process.platform === 'win32')('dmg-builder transient hdiutil retry patch', () => {
  let execDmgbuildWithRetry: ExecDmgbuildWithRetry
  let lockDirectory = ''
  const hostTemporaryDirectory = process.env.TMPDIR

  // electron-builder's toolset lock lives in os.tmpdir() and is fixed when its module loads.
  // A private TMPDIR keeps these tests off the machine-wide lock that real builds share.
  beforeAll(() => {
    lockDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-build-failure-lock-'))
    process.env.TMPDIR = lockDirectory
    execDmgbuildWithRetry = loadExecDmgbuildWithRetry()
  })

  afterAll(() => {
    if (hostTemporaryDirectory === undefined) {
      delete process.env.TMPDIR
    } else {
      process.env.TMPDIR = hostTemporaryDirectory
    }
    fs.rmSync(lockDirectory, { recursive: true, force: true })
  })

  /** A dmgbuild stand-in that fails `failures` times with `message`, then succeeds. */
  function flakyDmgbuild(failures: number, message: string) {
    const directory = temporaryDirectory()
    const script = path.join(directory, 'dmgbuild')
    fs.writeFileSync(
      script,
      `#!/bin/sh
count=$(( $(cat "${directory}/calls" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "${directory}/calls"
if [ "$count" -le ${failures} ]; then echo "${message}" >&2; exit 1; fi
echo built
`,
      { mode: 0o755 },
    )
    const artifactPath = path.join(directory, 'openwaggle.dmg')
    const calls = () => Number(fs.readFileSync(path.join(directory, 'calls'), 'utf8'))
    return { script, artifactPath, calls }
  }

  it('retries a transient hdiutil device error and removes the partial artifact', async () => {
    const dmgbuild = flakyDmgbuild(2, 'hdiutil: create failed - Device not configured')
    fs.writeFileSync(dmgbuild.artifactPath, 'partial')
    await expect(
      execDmgbuildWithRetry(dmgbuild.script, [], dmgbuild.artifactPath, {}, 0),
    ).resolves.toContain('built')
    expect(dmgbuild.calls()).toBe(3)
    expect(fs.existsSync(dmgbuild.artifactPath)).toBe(false)
  })

  it('gives up after five attempts', async () => {
    const dmgbuild = flakyDmgbuild(9, 'hdiutil: attach failed - Device not configured')
    await expect(
      execDmgbuildWithRetry(dmgbuild.script, [], dmgbuild.artifactPath, {}, 0),
    ).rejects.toThrow('hdiutil: attach failed - Device not configured')
    expect(dmgbuild.calls()).toBe(5)
  })

  it('does not retry other dmgbuild failures', async () => {
    const dmgbuild = flakyDmgbuild(1, 'hdiutil: create failed - No space left on device')
    await expect(
      execDmgbuildWithRetry(dmgbuild.script, [], dmgbuild.artifactPath, {}, 0),
    ).rejects.toThrow('No space left on device')
    expect(dmgbuild.calls()).toBe(1)
  })
})
