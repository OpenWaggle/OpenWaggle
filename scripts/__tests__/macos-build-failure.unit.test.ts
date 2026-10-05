import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TRANSIENT_HDIUTIL_ERROR, transientMacosBuildFailure } from '../macos-build-failure'

// Captured from the 1.0.0-beta.1 release, run 36695614844: the arm64 submission uploaded, then
// the macOS runner lost its network while notarytool waited for Apple's verdict.
const RUNNER_OFFLINE_LOG = `  • signing         file=dist/mac-arm64/OpenWaggle.app platform=darwin type=distribution
  ⨯ Failed to notarize via notarytool.  Failed with unexpected result:

Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline." UserInfo={_kCFStreamErrorCodeKey=50, _NSURLErrorNWPathKey=unsatisfied (No network route)}, NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions/226731ef-31eb-4d4f-8ab6-f5afa83e7df3?})  failedTask=build
`

function dmgbuildFailureLog(hdiutilError: string) {
  return `  • notarization successful
  ⨯ /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild process failed 1
Exit code:
1
Output:
Exit code: 1. Command failed: /Users/runner/Library/Caches/electron-builder/dmg-builder@1.2.5/dmgbuild-bundle-arm64-75c8a6c-9epj3/dmgbuild -s /private/var/folders/s6/T/t-iPp4Tm/4.json OpenWaggle 1.0.0-beta.8 /Users/runner/work/OpenWaggle/OpenWaggle/dist/openwaggle-1.0.0-beta.8-x64.dmg
${hdiutilError}
plistlib.InvalidFileException: Invalid file
  failedTask=build stackTrace=Error: dmgbuild process failed 1
`
}

// Run 37285929256: attempts 1 and 3 failed creating the x64 image, attempt 2 attaching arm64.
const HDIUTIL_CREATE_LOG = dmgbuildFailureLog('hdiutil: create failed - Device not configured')
const HDIUTIL_ATTACH_LOG = dmgbuildFailureLog('hdiutil: attach failed - Device not configured')

describe('macOS build failure classification', () => {
  it('treats notarytool losing its connection to Apple as transient', () => {
    expect(transientMacosBuildFailure(RUNNER_OFFLINE_LOG)).toBe('notarization-connection')
  })

  it('treats a timed-out request and an Apple-side 5xx as transient', () => {
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
      ),
    ).toBe('notarization-connection')
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 503, error: Service Unavailable)',
      ),
    ).toBe('notarization-connection')
  })

  it('treats an hdiutil device error that failed dmgbuild as transient', () => {
    expect(transientMacosBuildFailure(HDIUTIL_CREATE_LOG)).toBe('disk-image-device')
    expect(transientMacosBuildFailure(HDIUTIL_ATTACH_LOG)).toBe('disk-image-device')
    expect(
      transientMacosBuildFailure(dmgbuildFailureLog('hdiutil: create failed - Resource busy')),
    ).toBe('disk-image-device')
  })

  it('fails fast when Apple rejects the submission or the credentials', () => {
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\n  status: Invalid\n  message: Processing complete',
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        'Failed to notarize via notarytool\nError: HTTPError(statusCode: 401, error: Unauthorized)',
      ),
    ).toBeNull()
  })

  it('fails fast on a rejection even when the other architecture hit a device error', () => {
    expect(
      transientMacosBuildFailure(
        `${HDIUTIL_CREATE_LOG}\n  ⨯ Failed to notarize via notarytool\n  status: Invalid`,
      ),
    ).toBeNull()
  })

  it('fails fast on disk-image errors that a rebuild would not fix', () => {
    expect(
      transientMacosBuildFailure(dmgbuildFailureLog('hdiutil: create failed - No space left on device')),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(dmgbuildFailureLog('hdiutil: create failed - Operation not permitted')),
    ).toBeNull()
  })

  it('ignores hdiutil errors that did not fail dmgbuild', () => {
    expect(
      transientMacosBuildFailure(
        '  • hdiutil error: hdiutil: attach failed - Device not configured\n  ⨯ The identity is not valid for code signing  failedTask=build',
      ),
    ).toBeNull()
    expect(
      transientMacosBuildFailure(
        '  ⨯ dmgbuild process failed 1\nhdiutil: create failed - No space left on device\n  failedTask=build\n  • hdiutil: create failed - Device not configured',
      ),
    ).toBeNull()
  })

  it('ignores network errors that did not fail notarization', () => {
    expect(
      transientMacosBuildFailure(
        'Error Domain=NSURLErrorDomain Code=-1009 while downloading Electron\n⨯ cannot find module',
      ),
    ).toBeNull()
    expect(transientMacosBuildFailure('⨯ The identity is not valid for code signing')).toBeNull()
  })
})

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

describe('dmg-builder transient hdiutil retry patch', () => {
  const execDmgbuildWithRetry = loadExecDmgbuildWithRetry()

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

  it('registers the patch and retries the same errors the release classifier accepts', () => {
    const workspace = fs.readFileSync(path.join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8')
    const registration = /^ {2}dmg-builder@([\d.]+): patches\/dmg-builder@\1\.patch$/mu.exec(
      workspace,
    )
    expect(registration).not.toBeNull()
    const patch = fs.readFileSync(
      path.join(process.cwd(), `patches/dmg-builder@${registration?.[1]}.patch`),
      'utf8',
    )
    expect(patch).toContain(`/${TRANSIENT_HDIUTIL_ERROR.source}/;`)
    expect(patch).toContain('+    await execDmgbuildWithRetry(dmgbuild,')
  })

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
