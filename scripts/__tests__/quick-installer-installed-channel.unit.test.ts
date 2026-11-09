import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

/** A stand-in for the installed CLI that records its arguments and prints `output`. */
async function fakeCli(output: string, exitCode = 0) {
  const executable = path.join(directory, 'OpenWaggle')
  await fs.writeFile(path.join(directory, 'output'), output)
  await fs.writeFile(
    executable,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${directory}/calls"
if [ -n "\${OPENWAGGLE_CLI_OUTPUT_FD:-}" ]; then exec 1>&3; fi
cat "${directory}/output"
exit ${exitCode}
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

async function installedChannel(platform: 'mac' | 'linux', executable: string, version: string) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const sections = SECTIONS.map(([startMarker, endMarker]) => {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker)
    if (start < 0 || end <= start) throw new Error(`${startMarker} was not found in install.sh.`)
    return source.slice(start + startMarker.length, end)
  }).join('\n')
  const script = `set -euo pipefail
info() { :; }
error() { exit 1; }
${sections}
installed_update_channel "$@"`
  const result = await execFileAsync('bash', [
    '-c',
    script,
    'installer-installed-channel-test',
    platform,
    executable,
    version,
  ])
  return result.stdout.trim()
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

  it('reports nothing when the check fails or prints no channel', async () => {
    const failing = await fakeCli(
      '{"schemaVersion":1,"type":"error","error":{"kind":"internal","message":"offline"}}\n',
      1,
    )
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
