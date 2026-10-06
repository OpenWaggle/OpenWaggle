import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const SECTION_START = '# BEGIN TESTABLE SESSION HOST STOP'
const SECTION_END = '# END TESTABLE SESSION HOST STOP'
const CURRENT_VERSION = '1.0.0-beta.10'

let directory = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-host-stop-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

/** A stand-in for the installed app's CLI that records its arguments and what it read on stdin. */
async function fakeCli(input: { readonly help: 'update' | 'plain'; readonly state: string }) {
  const executable = path.join(directory, 'OpenWaggle')
  const help =
    input.help === 'update' ? 'openwaggle host stop --update [--json]' : 'openwaggle host stop [--wait]'
  await fs.writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${directory}/calls"
cat >> "${directory}/stdin"
# Like the AppImage CLI: its output goes to the descriptor the shim names.
if [ -n "\${OPENWAGGLE_CLI_OUTPUT_FD:-}" ]; then exec 1>&3; fi
if [ "$2" = "--help" ]; then printf '%s\\n' '${help}'; exit 0; fi
printf '{\\n  "type": "response",\\n  "result": {\\n    "state": "${input.state}"\\n  }\\n}\\n'
`,
    { mode: 0o755 },
  )
  return executable
}

/** Runs the installer section with the commands it needs from the rest of install.sh stubbed. */
async function runSection(
  command: string,
  args: readonly string[],
  platform = 'mac',
  searchPath = process.env.PATH ?? '',
) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const start = source.indexOf(SECTION_START)
  const end = source.indexOf(SECTION_END)
  if (start < 0 || end <= start) throw new Error('Installer Session Host stop was not found.')
  const script = `set -euo pipefail
info() { printf 'info: %s\\n' "$*"; }
error() { printf 'error: %s\\n' "$*"; exit 1; }
hdiutil() { printf 'hdiutil %s\\n' "$*" >> "${directory}/calls"; }
open() { printf 'open %s\\n' "$*" >> "${directory}/calls"; }
PLATFORM="${platform}"
MOUNT_POINT="/Volumes/OpenWaggle"
INSTALLED_APP_PATH="/Applications/OpenWaggle.app"
DOWNLOAD_PATH="${directory}/download.dmg"
QUIT_MAC_APP="1"
${source.slice(start + SECTION_START.length, end)}
${command} "$@"`
  const child = execFileAsync('bash', ['-c', script, 'installer-host-stop-test', ...args], {
    env: { PATH: searchPath },
  })
  // The rest of a piped install script must never reach the CLI.
  child.child.stdin?.end('rest of the install script\n')
  const result = await child.catch((error: { stdout: string; code: number }) => error)
  return { stdout: result.stdout.trim(), exitCode: 'code' in result ? result.code : 0 }
}

async function stopState(platform: 'mac' | 'linux', executable: string, version = CURRENT_VERSION) {
  return (await runSection('session_host_update_stop_state', [platform, executable, version]))
    .stdout
}

async function calls() {
  return (await fs.readFile(path.join(directory, 'calls'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
}

describe('quick installer Session Host stop', () => {
  it.each(['mac', 'linux'] as const)(
    'asks the installed CLI on %s to stop its Host for the update',
    async (platform) => {
      const executable = await fakeCli({ help: 'update', state: 'stopped' })

      await expect(stopState(platform, executable)).resolves.toBe('stopped')
      expect(await calls()).toEqual(['host --help', 'host stop --update --json'])
      await expect(fs.readFile(path.join(directory, 'stdin'), 'utf8')).resolves.toBe('')
    },
  )

  it('reports a cancelled update so the installer leaves the app unchanged', async () => {
    const executable = await fakeCli({ help: 'update', state: 'cancelled' })

    await expect(stopState('mac', executable)).resolves.toBe('cancelled')
  })

  it('stops an older version, which has no update stop, with a bounded plain stop', async () => {
    const executable = await fakeCli({ help: 'plain', state: 'timed-out' })

    await expect(stopState('mac', executable, '1.0.0-beta.9')).resolves.toBe('timed-out')
    expect(await calls()).toEqual(['host --help', 'host stop --wait --timeout-ms 20000 --json'])
  })

  it('never runs a version without the host command, which would open its window', async () => {
    const executable = await fakeCli({ help: 'plain', state: 'stopped' })

    await expect(stopState('mac', executable, '0.4.0-alpha.9')).resolves.toBe('unsupported')
    expect(await calls()).toEqual([])
  })

  it('bounds the CLI of a Linux AppImage whose version is not recorded', async () => {
    const executable = await fakeCli({ help: 'update', state: 'stopped' })
    const bin = path.join(directory, 'bin')
    await fs.mkdir(bin)
    // A coreutils timeout that records its bound and runs the command.
    await fs.writeFile(
      path.join(bin, 'timeout'),
      `#!/bin/sh\nprintf 'timeout %s\\n' "$1" >> "${directory}/calls"\nshift\nexec "$@"\n`,
      { mode: 0o755 },
    )

    const result = await runSection(
      'session_host_update_stop_state',
      ['linux', executable, ''],
      'linux',
      `${bin}:${process.env.PATH ?? ''}`,
    )

    expect(result.stdout).toBe('stopped')
    expect(await calls()).toEqual(['timeout 30', 'host --help', 'host stop --update --json'])
  })

  it('has nothing to stop on a first install', async () => {
    await expect(stopState('mac', path.join(directory, 'missing'))).resolves.toBe('not-installed')
  })

  it('reopens the quit app and changes nothing when the user cancels', async () => {
    const executable = await fakeCli({ help: 'update', state: 'cancelled' })

    const result = await runSection('stop_session_host_for_update', [executable, CURRENT_VERSION])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('error: Update cancelled. OpenWaggle was not changed.')
    expect(await calls()).toEqual([
      'host --help',
      'host stop --update --json',
      'hdiutil detach /Volumes/OpenWaggle -quiet',
      'open /Applications/OpenWaggle.app',
    ])
  })

  it('stops on macOS when the app was opened again while it waited for runs', async () => {
    const executable = await fakeCli({ help: 'update', state: 'desktop-open' })

    const result = await runSection('stop_session_host_for_update', [executable, CURRENT_VERSION])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('OpenWaggle was opened again')
  })

  it('does not replace the macOS bundle while another process keeps starting a Host', async () => {
    const executable = await fakeCli({ help: 'update', state: 'replaced' })

    const result = await runSection('stop_session_host_for_update', [executable, CURRENT_VERSION])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('keeps starting a Session Host')
    expect(await calls()).toContain('open /Applications/OpenWaggle.app')
  })

  it('leaves an open Linux app its Host and keeps installing', async () => {
    const executable = await fakeCli({ help: 'update', state: 'desktop-open' })

    const result = await runSection(
      'stop_session_host_for_update',
      [executable, CURRENT_VERSION],
      'linux',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Quit it, then run `openwaggle host stop --update`')
  })

  it('quits the app, then stops its Host, then replaces it on macOS', async () => {
    const source = await fs.readFile('scripts/install.sh', 'utf8')
    const quit = source.indexOf('  quit_running_mac_app\n')
    const stop = source.indexOf('  stop_session_host_for_update "${INSTALLED_APP_PATH}')
    const replace = source.indexOf('  rm -rf "${INSTALLED_APP_PATH}"')

    expect(quit).toBeGreaterThan(0)
    expect(stop).toBeGreaterThan(quit)
    expect(replace).toBeGreaterThan(stop)
  })
})
