import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const LAUNCH_POLICY_START = '# BEGIN TESTABLE LAUNCH POLICY'
const LAUNCH_POLICY_END = '# END TESTABLE LAUNCH POLICY'

async function launchSkipReason(
  platform: 'mac' | 'linux',
  environment: Readonly<Record<string, string>>,
  noLaunchArgument = false,
) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const start = source.indexOf(LAUNCH_POLICY_START)
  const end = source.indexOf(LAUNCH_POLICY_END)
  if (start < 0 || end <= start) throw new Error('Installer launch policy was not found.')
  const script = `set -euo pipefail
NO_LAUNCH_ARGUMENT="${noLaunchArgument ? '1' : ''}"
${source.slice(start + LAUNCH_POLICY_START.length, end)}
launch_skip_reason "$1"`
  const result = await execFileAsync('bash', ['-c', script, 'installer-launch-test', platform], {
    env: { PATH: process.env.PATH ?? '', ...environment },
  })
  return result.stdout.trim()
}

describe('quick installer launch policy', () => {
  it('opens the app after a desktop install with a graphical session', async () => {
    await expect(launchSkipReason('mac', {})).resolves.toBe('')
    await expect(launchSkipReason('linux', { DISPLAY: ':0' })).resolves.toBe('')
    await expect(launchSkipReason('linux', { WAYLAND_DISPLAY: 'wayland-0' })).resolves.toBe('')
  })

  it('skips the launch when asked to', async () => {
    await expect(launchSkipReason('mac', {}, true)).resolves.toBe('launch was disabled')
    await expect(launchSkipReason('mac', { OPENWAGGLE_NO_LAUNCH: '1' })).resolves.toBe(
      'launch was disabled',
    )
  })

  it('skips the launch without a graphical session', async () => {
    await expect(launchSkipReason('mac', { CI: 'true' })).resolves.toBe('running in CI')
    await expect(launchSkipReason('mac', { SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22' })).resolves.toBe(
      'running over SSH',
    )
    await expect(launchSkipReason('linux', {})).resolves.toBe('no graphical session is available')
  })

  it('rejects unknown installer options before doing any work', async () => {
    await expect(execFileAsync('bash', ['scripts/install.sh', '--bogus'])).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown option: --bogus'),
    })
  })
})
