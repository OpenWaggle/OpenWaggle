import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseWindowsJobStatus,
  waitForWindowsJobState,
} from '../windows-job-object'

const PROJECT_ROOT = process.cwd()
const LAUNCHER = fs.readFileSync(
  path.join(PROJECT_ROOT, 'scripts/qa/windows-job-object-launcher.ps1'),
  'utf8',
)
const PACKAGED_SMOKE = fs.readFileSync(
  path.join(PROJECT_ROOT, 'scripts/qa/packaged-session-host-startup-smoke.ts'),
  'utf8',
)

describe('Windows Job Object QA ownership', () => {
  it('parses append-only assignment, empty, and failure states', () => {
    expect(parseWindowsJobStatus('assigned\t42\n')).toEqual({ status: 'assigned', rootPid: 42 })
    expect(parseWindowsJobStatus('assigned\t42\nempty\t0\n')).toEqual({ status: 'empty' })
    expect(
      parseWindowsJobStatus(
        `assigned\t42\nfailed\t${Buffer.from('assignment failed').toString('base64')}\n`,
      ),
    ).toEqual({ status: 'failed', message: 'assignment failed' })
    expect(parseWindowsJobStatus('assigned\t42\nempty')).toEqual({ status: 'assigned', rootPid: 42 })
  })

  it('waits deterministically for kernel-reported empty state', async () => {
    const states = ['', 'assigned\t42\n', 'assigned\t42\nempty\t0\n']
    let clock = 0

    await expect(
      waitForWindowsJobState('empty', 100, {
        childExited: () => false,
        now: () => clock,
        readStatus: async () => states.shift() ?? 'assigned\t42\nempty\t0\n',
        wait: async (milliseconds) => {
          clock += milliseconds
        },
      }),
    ).resolves.toEqual({ status: 'empty' })
  })

  it('observes assignment even when the short-lived job is already empty', async () => {
    await expect(
      waitForWindowsJobState('assigned', 100, {
        childExited: () => true,
        now: () => 0,
        readStatus: async () => 'assigned\t42\nempty\t0\n',
        wait: async () => undefined,
      }),
    ).resolves.toEqual({ status: 'assigned', rootPid: 42 })
  })

  it('fails closed when the owner exits without ActiveProcesses proof', async () => {
    await expect(
      waitForWindowsJobState('empty', 100, {
        childExited: () => true,
        now: () => 0,
        readStatus: async () => 'assigned\t42\n',
        wait: async () => undefined,
      }),
    ).rejects.toThrow('owner exited before empty was proven')
  })

  it('assigns the suspended root before resume and owns all descendants until empty', () => {
    const create = LAUNCHER.indexOf('CreateProcessW(executable')
    const assign = LAUNCHER.indexOf('AssignProcessToJobObject(job, process.hProcess)')
    const resume = LAUNCHER.indexOf('ResumeThread(process.hThread)')

    expect(LAUNCHER).toContain('CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT')
    expect(create).toBeGreaterThan(0)
    expect(assign).toBeGreaterThan(create)
    expect(resume).toBeGreaterThan(assign)
    expect(LAUNCHER).toContain(
      'limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
    )
    expect(LAUNCHER).toContain('QueryInformationJobObject')
    expect(LAUNCHER).toContain('return accounting.ActiveProcesses')
    expect(LAUNCHER).toContain("if ($active -eq 0)")
    expect(LAUNCHER).toContain("Write-JobState 'empty' '0'")
  })

  it('uses kernel ownership for the real packaged Windows second-instance probe', () => {
    expect(PACKAGED_SMOKE).toContain("if (process.platform === 'win32')")
    expect(PACKAGED_SMOKE).toContain('launchInWindowsJobObject(')
    expect(PACKAGED_SMOKE).toContain('await secondGui.waitForEmpty()')
    expect(PACKAGED_SMOKE).toContain('await secondGui.terminateAndWait()')
    expect(PACKAGED_SMOKE).not.toContain('trackWindowsProcessTreeThroughExit')
  })
})
