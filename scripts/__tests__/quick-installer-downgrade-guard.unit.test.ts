import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const SECTIONS = [
  ['# BEGIN TESTABLE RELEASE RESOLUTION', '# END TESTABLE RELEASE RESOLUTION'],
  ['# BEGIN TESTABLE DOWNGRADE GUARD', '# END TESTABLE DOWNGRADE GUARD'],
] as const
const OLDER_THAN_INSTALLED = 'is older than the installed'

async function guardSource() {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  return SECTIONS.map(([startMarker, endMarker]) => {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker)
    if (start < 0 || end <= start) throw new Error(`${startMarker} was not found in install.sh.`)
    return source.slice(start + startMarker.length, end)
  }).join('\n')
}

/** Runs `downgrade_refusal` once per installed/target pair and returns each refusal, or ''. */
async function refusals(pairs: readonly (readonly [installed: string, target: string])[]) {
  const script = `set -euo pipefail
${await guardSource()}
while [ "$#" -gt 0 ]; do
  printf '%s\\n' "$(downgrade_refusal "$1" "$2")"
  shift 2
done`
  const result = await execFileAsync('bash', [
    '-c',
    script,
    'installer-downgrade-test',
    ...pairs.flat(),
  ])
  return result.stdout.split('\n').slice(0, pairs.length)
}

describe('quick installer downgrade guard', () => {
  it('refuses a target older than the installed version', async () => {
    const [rcOverBeta, stableOverRc, newerPatch] = await refusals([
      ['1.0.0-rc.1', 'v1.0.0-beta.37'],
      ['1.0.0', 'v1.0.0-rc.2'],
      ['1.0.1', 'v1.0.0'],
    ])

    expect(rcOverBeta).toBe(
      'OpenWaggle v1.0.0-beta.37 is older than the installed 1.0.0-rc.1. Downgrades are ' +
        'unsupported: an older version may not open the data this version has already migrated.',
    )
    expect(stableOverRc).toContain(OLDER_THAN_INSTALLED)
    expect(newerPatch).toContain(OLDER_THAN_INSTALLED)
  })

  it('installs a newer version and reinstalls the installed one', async () => {
    await expect(
      refusals([
        ['1.0.0-beta.37', 'v1.0.0-rc.1'],
        ['1.0.0-rc.1', 'v1.0.0'],
        ['1.0.0-rc.1', 'v1.0.0-rc.1'],
        ['v1.0.0-rc.1', '1.0.0-rc.1'],
      ]),
    ).resolves.toEqual(['', '', '', ''])
  })

  it('installs over a missing or unknown version as before', async () => {
    await expect(
      refusals([
        ['', 'v1.0.0-beta.1'],
        ['1.0.0-nightly', 'v1.0.0-beta.1'],
      ]),
    ).resolves.toEqual(['', ''])
  })

  it('refuses a target it cannot compare with a known installed version', async () => {
    const [refusal] = await refusals([['1.0.0-rc.1', 'nightly']])

    expect(refusal).toBe(
      'OpenWaggle cannot compare nightly with the installed version 1.0.0-rc.1, so it does not install it.',
    )
  })

  it('cleans up and exits with status 2, as openwaggle update --version does', async () => {
    const script = `set -euo pipefail
${await guardSource()}
restore_installed_app() { printf 'restored\\n'; }
refuse_downgrade "$1" "$2"
printf 'installed\\n'`
    const result = await execFileAsync('bash', [
      '-c',
      script,
      'installer-downgrade-exit-test',
      '1.0.0-rc.1',
      'v1.0.0-beta.37',
    ]).catch((error: { stdout: string; stderr: string; code: number }) => error)

    expect('code' in result ? result.code : 0).toBe(2)
    expect(result.stdout).toBe('restored\n')
    expect(result.stderr).toContain(`${OLDER_THAN_INSTALLED} 1.0.0-rc.1.`)
    expect(result.stderr).toContain('OpenWaggle was not changed.')
  })

  it('says how to pick another release when it was given a hint', async () => {
    const script = `set -euo pipefail
${await guardSource()}
restore_installed_app() { :; }
refuse_downgrade "$1" "$2" "$3"`
    const result = await execFileAsync('bash', [
      '-c',
      script,
      'installer-downgrade-hint-test',
      '1.0.1-beta.1',
      'v1.0.0',
      'It is ahead of the stable channel.',
    ]).catch((error: { stderr: string; code: number }) => error)

    expect(result.stderr).toContain(
      'OpenWaggle was not changed. It is ahead of the stable channel.\n',
    )
  })

  it('takes the newer of two versions, either of which may be missing', async () => {
    const script = `set -euo pipefail
${await guardSource()}
while [ "$#" -gt 0 ]; do
  printf '%s\\n' "$(newer_release_version "$1" "$2")"
  shift 2
done`
    const pairs = [
      ['1.0.0-rc.2', '1.0.0-rc.1'],
      ['1.0.0-rc.1', '1.0.0-rc.2'],
      ['', '1.0.0-rc.1'],
      ['1.0.0-rc.1', ''],
    ]
    const result = await execFileAsync('bash', [
      '-c',
      script,
      'installer-newer-test',
      ...pairs.flat(),
    ])

    expect(result.stdout.split('\n').slice(0, pairs.length)).toEqual([
      '1.0.0-rc.2',
      '1.0.0-rc.2',
      '1.0.0-rc.1',
      '1.0.0-rc.1',
    ])
  })

  // PlistBuddy prints "File Doesn't Exist, Will Create: …" on stdout for a missing Info.plist.
  it('reports no macOS version for a bundle without an Info.plist', async () => {
    const script = `set -euo pipefail
${await guardSource()}
printf '[%s]' "$(mac_app_version "$1")"`
    const result = await execFileAsync('bash', [
      '-c',
      script,
      'installer-mac-version-test',
      '/nonexistent/OpenWaggle.app',
    ])

    expect(result.stdout).toBe('[]')
  })

  it('checks before the download, and on macOS before the app is quit or its Host stopped', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const call = 'refuse_downgrade "${INSTALLED_VERSION}" "${VERSION}" "${DOWNGRADE_HINT}"\n'
    const early = source.indexOf(call)
    const download = source.indexOf('info "Downloading ${FILENAME}…"')
    const macCheck = source.indexOf(`  ${call}`)
    const quit = source.indexOf('  quit_running_mac_app "${INSTALLED_APP_PATH}"\n')
    const stops = [...source.matchAll(/^ {2}stop_session_host_for_update /gmu)].map(
      (match) => match.index,
    )

    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(download)
    expect(macCheck).toBeGreaterThan(download)
    expect(macCheck).toBeLessThan(quit)
    expect(stops).toHaveLength(2)
    for (const stop of stops) expect(stop).toBeGreaterThan(early)
    expect(stops[0]).toBeGreaterThan(quit)
  })
})
