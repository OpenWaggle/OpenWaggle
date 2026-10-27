import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decideWakeCheck } from '../../../domain/scheduled-tasks/wake-check-decision'

vi.mock('electron', () => ({ app: { getVersion: () => 'test', getPath: () => os.tmpdir() } }))

const POSIX = process.platform !== 'win32'
let workspace = ''

beforeEach(async () => {
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-wake-check-')))
  vi.stubEnv('OPENWAGGLE_PROFILE', 'leaked-profile')
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(workspace, { recursive: true, force: true })
})

async function check(
  command: string,
  options: { readonly timeoutMs?: number; readonly outputLimitBytes?: number } = {},
) {
  const { runWakeCheckProcess } = await import('../wake-check-process')
  return runWakeCheckProcess(
    { command, workingPath: workspace, projectPath: '/project-root' },
    { appVersion: 'test', ...options },
  )
}

describe.runIf(POSIX)('Wake check process (#388)', () => {
  it('finds nothing to do when the command exits 0 silently, and wakes on output or a non-zero exit', async () => {
    expect(decideWakeCheck('true', await check('true'), 30_000)).toEqual({ kind: 'idle' })
    expect(decideWakeCheck('echo', await check('echo "check lint failed"'), 30_000)).toMatchObject({
      kind: 'woke',
      report: { stdout: 'check lint failed\n', exitCode: 0 },
    })
    expect(decideWakeCheck('exit 3', await check('exit 3'), 30_000)).toMatchObject({
      kind: 'woke',
      report: { exitCode: 3 },
      message: 'The Wake check exited 3.',
    })
    // Noise on stderr with a clean exit is not work to do.
    expect(decideWakeCheck('warn', await check('echo warning >&2'), 30_000)).toEqual({
      kind: 'idle',
    })
  })

  it('runs in the Session workspace with the Project actions environment, no app secrets', async () => {
    const execution = await check(
      'pwd; printf "%s|%s|%s|%s" "$OPENWAGGLE_WORKTREE_PATH" "$OPENWAGGLE_PROJECT_ROOT" "${OPENWAGGLE_PROFILE:-unset}" "${ELECTRON_RUN_AS_NODE:-unset}"',
    )
    expect(execution.stdout).toBe(`${workspace}\n${workspace}|/project-root|unset|unset`)
  })

  it('fails, never "nothing to do", when the command cannot run or times out, and kills what it started', async () => {
    const missing = await check('definitely-not-a-command-388')
    expect(decideWakeCheck('x', missing, 30_000)).toMatchObject({
      kind: 'failed',
      report: { exitCode: 127 },
    })
    const started = Date.now()
    const slow = await check('sleep 20 & echo started; wait', { timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(slow.timedOut).toBe(true)
    expect(decideWakeCheck('sleep', slow, 30_000)).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('timed out after 30 s'),
    })
    await fs.rm(workspace, { recursive: true, force: true })
    expect((await check('true')).startError).toMatch(/no longer exists/)
  })

  it('keeps at most the output cap and says the rest was dropped', async () => {
    const execution = await check('head -c 50000 /dev/zero | tr "\\0" a', {
      outputLimitBytes: 1024,
    })
    expect(execution.stdout).toHaveLength(1024)
    expect(execution.truncated).toBe(true)
    expect(execution.exitCode).toBe(0)
  })
})
