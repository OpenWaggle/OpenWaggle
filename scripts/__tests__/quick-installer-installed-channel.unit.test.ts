import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessionsCliResponseText } from '../../src/main/sessions-cli-output'
import { writeUpdateCheckError } from '../../src/main/update-cli-check-output'

const execFileAsync = promisify(execFile)
const SECTIONS = [
  ['# BEGIN TESTABLE RELEASE RESOLUTION', '# END TESTABLE RELEASE RESOLUTION'],
  ['# BEGIN TESTABLE SESSION HOST STOP', '# END TESTABLE SESSION HOST STOP'],
  ['# BEGIN TESTABLE INSTALLED UPDATE CHANNEL', '# END TESTABLE INSTALLED UPDATE CHANNEL'],
] as const
const CHANNEL_CHECK_VERSION = '1.0.0-rc.1'

let directory = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-installed-channel-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

/**
 * A stand-in for the installed CLI that records its arguments, prints `output` (to descriptor 3
 * like the AppImage) and `errorOutput` to stderr, then waits `delaySeconds`.
 */
async function fakeCli(
  output: string,
  options: {
    readonly exitCode?: number
    readonly errorOutput?: string
    readonly delaySeconds?: number
  } = {},
) {
  const executable = path.join(directory, 'OpenWaggle')
  await fs.writeFile(path.join(directory, 'output'), output)
  await fs.writeFile(path.join(directory, 'error-output'), options.errorOutput ?? '')
  await fs.writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${directory}/calls"
if [ -n "\${OPENWAGGLE_CLI_OUTPUT_FD:-}" ]; then exec 1>&3; fi
printf '%s\\n' "$$" > "${directory}/pid"
cat "${directory}/error-output" >&2
${options.delaySeconds === undefined ? '' : `exec sleep ${options.delaySeconds}`}
cat "${directory}/output"
exit ${options.exitCode ?? 0}
`,
    { mode: 0o755 },
  )
  return executable
}

function checkResponse(savedChannel: string) {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      type: 'response',
      command: 'update',
      result: { savedChannel, channel: 'alpha', status: 'available', version: '1.0.1-alpha.1' },
    },
    null,
    2,
  )}\n`
}

/** The installer sections `installed_update_channel` needs, then a call to it with "$@" that prints its result. */
async function channelReadScript(timeoutSeconds?: number) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const sections = SECTIONS.map(([startMarker, endMarker]) => {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker)
    if (start < 0 || end <= start) throw new Error(`${startMarker} was not found in install.sh.`)
    return source.slice(start + startMarker.length, end)
  }).join('\n')
  return `set -euo pipefail
info() { :; }
error() { exit 1; }
${sections}
${timeoutSeconds === undefined ? '' : `INSTALLED_CHANNEL_READ_TIMEOUT_SECONDS=${timeoutSeconds}`}
installed_update_channel "$@"
printf '%s\\n' "\${INSTALLED_CHANNEL}"`
}

async function installedChannel(
  platform: 'mac' | 'linux',
  executable: string,
  version: string,
  timeoutSeconds?: number,
) {
  const script = await channelReadScript(timeoutSeconds)
  const args = ['-c', script, 'installer-installed-channel-test', platform, executable, version]
  const result = await execFileAsync('bash', args, {
    env: { PATH: process.env['PATH'] ?? '', TMPDIR: directory },
  })
  return result.stdout.trim()
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function calls() {
  return (await fs.readFile(path.join(directory, 'calls'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
}

describe('quick installer installed update channel', () => {
  it.each(['mac', 'linux'] as const)(
    'reads the saved channel, not the checked one, from the installed CLI on %s',
    async (platform) => {
      const executable = await fakeCli(checkResponse('beta'))

      await expect(installedChannel(platform, executable, CHANNEL_CHECK_VERSION)).resolves.toBe(
        'beta',
      )
      expect(await calls()).toEqual(['update --check --json'])
    },
  )

  it.each([
    ['without a version', ''],
    ['before 1.0.0-beta.1', '0.4.0-alpha.9'],
    ['before update --check --json', '1.0.0-beta.37'],
  ])('never runs an installed CLI %s', async (_label, version) => {
    const executable = await fakeCli(checkResponse('alpha'))

    await expect(installedChannel('mac', executable, version)).resolves.toBe('')
    expect(await calls()).toEqual([])
  })

  it.each(['mac', 'linux'] as const)(
    'reads what the real CLI output functions print on %s',
    async (platform) => {
      const response = sessionsCliResponseText(
        'update',
        { savedChannel: 'alpha', channel: 'alpha', status: 'up-to-date' },
        true,
      )
      const executable = await fakeCli(response)
      await expect(installedChannel(platform, executable, CHANNEL_CHECK_VERSION)).resolves.toBe(
        'alpha',
      )

      // A failed release check still reports the channel, in the error envelope on stderr.
      let envelope = ''
      writeUpdateCheckError(new Error('feed unavailable'), 'beta', (value) => {
        envelope = value
      })
      const failing = await fakeCli('', { exitCode: 1, errorOutput: envelope })
      await expect(installedChannel(platform, failing, CHANNEL_CHECK_VERSION)).resolves.toBe('beta')
    },
  )

  it('gives up on a CLI that is still running at the deadline', async () => {
    const executable = await fakeCli(checkResponse('alpha'), { delaySeconds: 30 })
    const started = Date.now()

    await expect(installedChannel('mac', executable, CHANNEL_CHECK_VERSION, 1)).resolves.toBe('')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('stops the CLI and removes its output when the installer is interrupted', async () => {
    const executable = await fakeCli(checkResponse('alpha'), { delaySeconds: 30 })
    const script = await channelReadScript()
    const child = spawn(
      'bash',
      ['-c', script, 'installer-channel-interrupt-test', 'mac', executable, CHANNEL_CHECK_VERSION],
      { env: { PATH: process.env['PATH'] ?? '', TMPDIR: directory } },
    )
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
    // Wait until the CLI has started, then press Ctrl-C.
    while (!(await fs.readFile(path.join(directory, 'pid'), 'utf8').catch(() => ''))) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    child.kill('SIGINT')

    await expect(exited).resolves.toBe(130)
    const cliPid = Number((await fs.readFile(path.join(directory, 'pid'), 'utf8')).trim())
    expect(isRunning(cliPid)).toBe(false)
    const leftovers = (await fs.readdir(directory)).filter((name) =>
      name.startsWith('openwaggle-channel.'),
    )
    expect(leftovers).toEqual([])
  })

  it('reports nothing when the Session Host cannot read the channel', async () => {
    const failing = await fakeCli('', {
      exitCode: 1,
      errorOutput:
        '{"schemaVersion":1,"type":"error","error":{"kind":"internal","message":"offline"}}\n',
    })
    await expect(installedChannel('mac', failing, CHANNEL_CHECK_VERSION)).resolves.toBe('')

    const unknown = await fakeCli(checkResponse('nightly'))
    await expect(installedChannel('mac', unknown, CHANNEL_CHECK_VERSION)).resolves.toBe('')
  })

  it('has nothing to read on a first install', async () => {
    await expect(
      installedChannel('linux', path.join(directory, 'missing'), CHANNEL_CHECK_VERSION),
    ).resolves.toBe('')
  })
})
