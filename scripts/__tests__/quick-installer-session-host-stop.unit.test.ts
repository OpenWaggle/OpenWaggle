import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const SECTION_START = '# BEGIN TESTABLE SESSION HOST STOP'
const SECTION_END = '# END TESTABLE SESSION HOST STOP'

let directory = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-host-stop-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

/** A stand-in for the installed app's CLI that records its arguments and what it read on stdin. */
async function fakeCli(input: { readonly supportsUpdate: boolean; readonly state: string }) {
  const executable = path.join(directory, 'OpenWaggle')
  const help = input.supportsUpdate ? 'openwaggle host stop --update [--json]' : 'openwaggle host stop'
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

async function stopState(platform: 'mac' | 'linux', executable: string) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const start = source.indexOf(SECTION_START)
  const end = source.indexOf(SECTION_END)
  if (start < 0 || end <= start) throw new Error('Installer Session Host stop was not found.')
  const script = `set -euo pipefail
${source.slice(start + SECTION_START.length, end)}
session_host_update_stop_state "$1" "$2"`
  const child = execFileAsync('bash', ['-c', script, 'installer-host-stop-test', platform, executable], {
    env: { PATH: process.env.PATH ?? '' },
  })
  // The rest of a piped install script must never reach the CLI.
  child.child.stdin?.end('rest of the install script\n')
  const result = await child
  return result.stdout.trim()
}

async function calls() {
  return (await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n')
}

describe('quick installer Session Host stop', () => {
  it.each(['mac', 'linux'] as const)(
    'asks the installed CLI on %s to stop its Host for the update',
    async (platform) => {
      const executable = await fakeCli({ supportsUpdate: true, state: 'stopped' })

      await expect(stopState(platform, executable)).resolves.toBe('stopped')
      expect(await calls()).toEqual(['host --help', 'host stop --update --json'])
      await expect(fs.readFile(path.join(directory, 'stdin'), 'utf8')).resolves.toBe('')
    },
  )

  it('reports a cancelled update so the installer leaves the app unchanged', async () => {
    const executable = await fakeCli({ supportsUpdate: true, state: 'cancelled' })

    await expect(stopState('mac', executable)).resolves.toBe('cancelled')
  })

  it('stops an older version, which has no update stop, with a bounded plain stop', async () => {
    const executable = await fakeCli({ supportsUpdate: false, state: 'timed-out' })

    await expect(stopState('mac', executable)).resolves.toBe('timed-out')
    expect(await calls()).toEqual(['host --help', 'host stop --wait --timeout-ms 20000 --json'])
  })

  it('has nothing to stop on a first install', async () => {
    await expect(stopState('mac', path.join(directory, 'missing'))).resolves.toBe('not-installed')
  })
})
