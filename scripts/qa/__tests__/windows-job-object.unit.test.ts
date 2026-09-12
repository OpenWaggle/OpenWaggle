import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseWindowsJobStatus,
  waitForWindowsJobState,
} from '../windows-job-object'
import {
  assertSingleInstanceLockDeniedMarker,
  singleInstanceLockDeniedArguments,
} from '../single-instance-lock-proof'

const PROJECT_ROOT = process.cwd()
const LAUNCHER = fs.readFileSync(
  path.join(PROJECT_ROOT, 'scripts/qa/windows-job-object-launcher.ps1'),
  'utf8',
)
const PACKAGED_SMOKE = fs.readFileSync(
  path.join(PROJECT_ROOT, 'scripts/qa/packaged-session-host-startup-smoke.ts'),
  'utf8',
)
const MAIN_INDEX = fs.readFileSync(path.join(PROJECT_ROOT, 'src/main/index.ts'), 'utf8')

describe('Windows Job Object QA ownership', () => {
  it('parses append-only assignment, empty, and failure states', () => {
    expect(parseWindowsJobStatus('assigned\t42\n')).toEqual({ status: 'assigned', rootPid: 42 })
    expect(parseWindowsJobStatus('assigned\t42\nroot-exited\t0\n')).toEqual({
      status: 'root-exited',
      exitCode: 0,
    })
    expect(parseWindowsJobStatus('assigned\t42\nroot-exited\t0\nempty\t0\n')).toEqual({ status: 'empty' })
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
        readStatus: async () => 'assigned\t42\nroot-exited\t0\nempty\t0\n',
        wait: async () => undefined,
      }),
    ).resolves.toEqual({ status: 'assigned', rootPid: 42 })
  })

  it('requires a normal root exit before accepting an empty Job', async () => {
    await expect(
      waitForWindowsJobState('normal-exit', 100, {
        childExited: () => false,
        now: () => 0,
        readStatus: async () => 'assigned\t42\nroot-exited\t0\nempty\t0\n',
        wait: async () => undefined,
      }),
    ).resolves.toEqual({ status: 'root-exited', exitCode: 0 })

    await expect(
      waitForWindowsJobState('normal-exit', 100, {
        childExited: () => false,
        now: () => 0,
        readStatus: async () => 'assigned\t42\nroot-exited\t1\nempty\t0\n',
        wait: async () => undefined,
      }),
    ).rejects.toThrow('root exited with code 1')

    await expect(
      waitForWindowsJobState('normal-exit', 100, {
        childExited: () => true,
        now: () => 0,
        readStatus: async () => 'assigned\t42\nempty\t0\n',
        wait: async () => undefined,
      }),
    ).rejects.toThrow('owner exited before normal-exit was proven')
  })

  it('requires the explicit lock-denied marker and passes its isolated path as a switch', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'openwaggle-lock-denied-proof-'),
    )
    const markerPath = path.join(temporaryRoot, 'marker')
    try {
      expect(singleInstanceLockDeniedArguments(markerPath)).toEqual([
        `--openwaggle-automation-single-instance-lock-denied-marker=${markerPath}`,
      ])
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).rejects.toThrow(
        'did not prove single-instance lock denial',
      )
      await fs.promises.writeFile(markerPath, 'wrong\n')
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).rejects.toThrow(
        'invalid single-instance lock-denied marker',
      )
      await fs.promises.writeFile(markerPath, 'single-instance-lock-denied\n')
      await expect(assertSingleInstanceLockDeniedMarker(markerPath)).resolves.toBeUndefined()
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    }
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
    expect(LAUNCHER).toContain('GetExitCodeProcess(rootProcess, out exitCode)')
    expect(LAUNCHER).toContain("Write-JobState 'root-exited' ([string]$rootExitCode)")
    expect(LAUNCHER).toContain("if ($active -eq 0)")
    expect(LAUNCHER).toContain("Write-JobState 'empty' '0'")
  })

  it('uses kernel ownership for the real packaged Windows second-instance probe', () => {
    expect(PACKAGED_SMOKE).toContain("if (process.platform === 'win32')")
    expect(PACKAGED_SMOKE).toContain('launchInWindowsJobObject(')
    expect(PACKAGED_SMOKE).toContain('await secondGui.waitForNormalExit()')
    expect(PACKAGED_SMOKE).toContain('await assertSingleInstanceLockDeniedMarker(lockDeniedMarkerPath)')
    expect(PACKAGED_SMOKE).toContain('await secondGui.terminateAndWait()')
    expect(PACKAGED_SMOKE).not.toContain('trackWindowsProcessTreeThroughExit')
    expect(MAIN_INDEX).toContain(
      "'openwaggle-automation-single-instance-lock-denied-marker'",
    )
    expect(MAIN_INDEX).toContain("'single-instance-lock-denied\\n'")
    expect(MAIN_INDEX).toContain('quitAutomationSecondInstance()')
  })
})
