import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const QUIT_START = '# BEGIN TESTABLE MAC APP QUIT'
const QUIT_END = '# END TESTABLE MAC APP QUIT'
const HOST_STOP_START = '# BEGIN TESTABLE SESSION HOST STOP'
const HOST_STOP_END = '# END TESTABLE SESSION HOST STOP'
const TARGET_APP = '/Users/me/Apps/OpenWaggle.app'
const BUNDLE = 'OpenWaggle.app'

interface RunningApp {
  readonly asn: string
  readonly pid: number
  readonly type: 'Foreground' | 'UIElement'
  readonly bundlePath: string
}

let directory = ''
/** The physical bundle the installer replaces, as install.sh builds it with `pwd -P`. */
let targetApp = ''
let systemApp = ''

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'installer-mac-quit-')))
  targetApp = path.join(directory, 'Target', BUNDLE)
  systemApp = path.join(directory, 'Applications', BUNDLE)
  await fs.mkdir(targetApp, { recursive: true })
  await fs.mkdir(systemApp, { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function section(source: string, start: string, end: string) {
  const from = source.indexOf(start)
  const to = source.indexOf(end)
  if (from < 0 || to <= from) throw new Error(`Installer section ${start} was not found.`)
  return source.slice(from + start.length, to)
}

/**
 * Runs the quit section against a stand-in for `lsappinfo` that answers like macOS does, and a
 * `kill` that records its target and removes that app from the running list.
 */
async function quitInstalledApp(apps: readonly RunningApp[], bundlePath: string) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const killed = path.join(directory, 'killed')
  const records = apps
    .map((app) => `${app.asn} ${app.pid} ${app.type} ${app.bundlePath}`)
    .join('\n')
  const script = `set -euo pipefail
info() { printf 'info: %s\\n' "$*"; }
error() { printf 'error: %s\\n' "$*"; exit 1; }
sleep() { :; }
MAC_APP_ID="com.openwaggle.app"
APP_QUIT_WAIT_SECONDS=3
QUIT_MAC_APP=""
records='${records}'
is_killed() { grep -qx "$1" '${killed}' 2>/dev/null; }
lsappinfo() {
  case "$1" in
    find)
      printf '%s\\n' "$records" | while read -r asn pid type bundle; do
        is_killed "$pid" || printf '%s ' "$asn"
      done
      ;;
    info)
      printf '%s\\n' "$records" | while read -r asn pid type bundle; do
        [ "$asn" = "$4" ] || continue
        printf '"pid"=%s\\n"ApplicationType"="%s"\\n"LSBundlePath"="%s"\\n' "$pid" "$type" "$bundle"
      done
      ;;
  esac
}
kill() { printf '%s\\n' "$2" >> '${killed}'; }
${section(source, QUIT_START, QUIT_END)}
quit_running_mac_app "$1"
printf 'quit=%s\\n' "\${QUIT_MAC_APP}"`
  const result = await execFileAsync('bash', ['-c', script, 'installer-mac-quit-test', bundlePath])
  const killedPids = (await fs.readFile(killed, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
  return { stdout: result.stdout.trim(), killedPids }
}

describe('quick installer macOS app quit', () => {
  it('quits only the app whose bundle it replaces', async () => {
    const result = await quitInstalledApp(
      [
        { asn: 'ASN:0x0-0x1-"OpenWaggle":', pid: 101, type: 'Foreground', bundlePath: systemApp },
        { asn: 'ASN:0x0-0x2-"OpenWaggle":', pid: 202, type: 'Foreground', bundlePath: targetApp },
        // The target app's Session Host: same bundle, but never a window to quit.
        { asn: 'ASN:0x0-0x3-"OpenWaggle":', pid: 303, type: 'UIElement', bundlePath: targetApp },
      ],
      targetApp,
    )

    expect(result.killedPids).toEqual(['202'])
    expect(result.stdout).toContain('quit=1')
  })

  it('leaves OpenWaggle open elsewhere when the target directory has none running', async () => {
    const result = await quitInstalledApp(
      [{ asn: 'ASN:0x0-0x1-"OpenWaggle":', pid: 101, type: 'Foreground', bundlePath: systemApp }],
      targetApp,
    )

    expect(result.killedPids).toEqual([])
    expect(result.stdout).toBe('quit=')
  })

  it('matches the target app when it is reported through a symlinked directory', async () => {
    const linked = path.join(directory, 'Linked')
    await fs.symlink(path.dirname(targetApp), linked)

    const result = await quitInstalledApp(
      [
        {
          asn: 'ASN:0x0-0x1-"OpenWaggle":',
          pid: 101,
          type: 'Foreground',
          bundlePath: path.join(linked, BUNDLE),
        },
      ],
      targetApp,
    )

    expect(result.killedPids).toEqual(['101'])
  })

  it('does not match an app in a directory whose name merely starts with the target', async () => {
    const result = await quitInstalledApp(
      [
        {
          asn: 'ASN:0x0-0x1-"OpenWaggle":',
          pid: 101,
          type: 'Foreground',
          bundlePath: `${targetApp}.old`,
        },
      ],
      targetApp,
    )

    expect(result.killedPids).toEqual([])
  })
})

describe('quick installer Session Host stop while another OpenWaggle is open', () => {
  /** Runs the stop with an installed CLI that reports the desktop app open, as the shared Host does. */
  async function stopForUpdate(quitMacApp: '' | '1') {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const executable = path.join(directory, 'OpenWaggle')
    await fs.writeFile(
      executable,
      `#!/bin/sh
if [ "$2" = "--help" ]; then printf '%s\\n' 'openwaggle host stop --update [--json]'; exit 0; fi
printf '{ "state": "desktop-open" }\\n'
`,
      { mode: 0o755 },
    )
    const script = `set -euo pipefail
info() { printf 'info: %s\\n' "$*"; }
error() { printf 'error: %s\\n' "$*"; exit 1; }
hdiutil() { :; }
open() { printf 'open %s\\n' "$*"; }
PLATFORM=mac
MOUNT_POINT=/Volumes/OpenWaggle
INSTALLED_APP_PATH='${TARGET_APP}'
DOWNLOAD_PATH='${path.join(directory, 'download.dmg')}'
QUIT_MAC_APP='${quitMacApp}'
${section(source, HOST_STOP_START, HOST_STOP_END)}
stop_session_host_for_update "$1" 1.0.0-beta.25`
    return execFileAsync('bash', ['-c', script, 'installer-host-stop-test', executable], {
      env: { PATH: process.env.PATH ?? '', TMPDIR: directory },
    }).catch((error: { readonly stdout: string; readonly code: number }) => error)
  }

  it('asks to quit the other app instead of claiming it was reopened', async () => {
    const result = await stopForUpdate('')

    expect('code' in result ? result.code : 0).toBe(1)
    expect(result.stdout).toContain(
      'error: OpenWaggle is open and uses the Session Host this install must stop.',
    )
    // The installer quit nothing, so it reopens nothing.
    expect(result.stdout).not.toMatch(/^open /mu)
  })

  it('still reports an app reopened after the installer quit it', async () => {
    const result = await stopForUpdate('1')

    expect(result.stdout).toContain('error: OpenWaggle was opened again while the installer waited.')
    expect(result.stdout).toContain(`open ${TARGET_APP}`)
  })
})
