import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHILD_PID,
  CLOSED_TTY,
  makeSubject,
  missingProcessError,
  ROOT_PID,
  row,
  table,
} from './terminal-process-shutdown-force-test-harness'

const probes = vi.hoisted(() => ({
  readProcessMetadata: vi.fn(),
  readProcessTable: vi.fn(),
  readTerminalKernelProcessInfo: vi.fn(),
  signalTerminalProcessIdentity: vi.fn(),
}))

vi.mock('../terminal-process-probes', () => ({
  NO_TTY_FOREGROUND_GROUP: -1,
  parsePosixRow: vi.fn(),
  readListeningPorts: vi.fn(),
  readProcessMetadata: probes.readProcessMetadata,
  readProcessTable: probes.readProcessTable,
}))

vi.mock('../terminal-process-kernel-api', () => ({
  readTerminalKernelProcessInfo: probes.readTerminalKernelProcessInfo,
  signalTerminalProcessIdentity: probes.signalTerminalProcessIdentity,
}))

const { forceClosePty, forceValidatedTree, refreshAndConfirmExit, signalTree } = await import(
  '../terminal-process-control'
)
const { shutdownLiveTerminal } = await import('../terminal-process-shutdown')

describe('terminal forced shutdown proof', () => {
  beforeEach(() => {
    probes.readProcessTable.mockReset()
    probes.readProcessMetadata.mockReset()
    probes.readProcessMetadata.mockImplementation((pid: number) =>
      Promise.resolve({ pid, startedAt: `start-${pid}`, tty: null, ttyIdentity: null }),
    )
    probes.readTerminalKernelProcessInfo.mockReset()
    probes.readTerminalKernelProcessInfo.mockReturnValue({ status: 'unavailable' })
    probes.signalTerminalProcessIdentity.mockReset()
    probes.signalTerminalProcessIdentity.mockReturnValue('unavailable')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not launch a PowerShell tree scan after a Windows job-owned exit', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      const refreshed = await refreshAndConfirmExit(
        { whenExited: Promise.resolve(), exitCode: 0 },
        ROOT_PID,
        [ROOT_PID, CHILD_PID],
        [],
        null,
        null,
        true,
        true,
        50,
      )

      expect(refreshed.confirmed).toBe(true)
      expect(refreshed.reliable).toBe(true)
      expect(probes.readProcessTable).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('does not start a POSIX process probe after the shutdown deadline expires', async () => {
    const refreshed = await refreshAndConfirmExit(
      { whenExited: new Promise(() => undefined), exitCode: null },
      ROOT_PID,
      [ROOT_PID, CHILD_PID],
      [
        { pid: ROOT_PID, startedAt: `start-${ROOT_PID}` },
        { pid: CHILD_PID, startedAt: `start-${CHILD_PID}` },
      ],
      CLOSED_TTY,
      null,
      false,
      true,
      0,
    )

    expect(refreshed).toMatchObject({ confirmed: false, reliable: false })
    expect(probes.readProcessTable).not.toHaveBeenCalled()
  })

  it('does not wait for delayed Windows output cleanup after the job closes', async () => {
    const platform = process.platform
    const subject = makeSubject('powershell.exe')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      await expect(shutdownLiveTerminal(subject.record, vi.fn())).resolves.toBe(true)

      expect(subject.closeDescriptor).toHaveBeenCalledOnce()
      expect(subject.record.termination).toBeNull()
      expect(subject.record.live).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('never turns Windows process snapshots into raw-PID signals', () => {
    const platform = process.platform
    const subject = makeSubject('powershell.exe')
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      expect(signalTree(subject.live, [ROOT_PID, CHILD_PID], true)).toBe(true)
      expect(subject.closeDescriptor).toHaveBeenCalledOnce()
      expect(processKill).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('fails closed when node-pty exposes no descriptor-only POSIX close', () => {
    const subject = makeSubject('stubborn-flood')
    for (const closeDescriptor of [null, {}, 42]) {
      Reflect.set(subject.live.pty, 'closeDescriptor', closeDescriptor)

      expect(forceClosePty(subject.live)).toBe(false)
    }

    expect(subject.publicDestroy).not.toHaveBeenCalled()
    expect(subject.live.pty.kill).not.toHaveBeenCalled()
  })

  it('does not start an identity-bound signal after its deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_006)
    const subject = makeSubject('detached-worker')
    const secondChildPid = CHILD_PID + 1
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
    await forceValidatedTree(
      subject.live,
      [ROOT_PID, CHILD_PID, secondChildPid].map((pid) => ({
        pid,
        startedAt: `start-${pid}`,
      })),
      { whenExited: new Promise(() => undefined), exitCode: null },
      true,
      1_005,
    )

    expect(probes.signalTerminalProcessIdentity).not.toHaveBeenCalled()
    expect(processKill).not.toHaveBeenCalledWith(CHILD_PID, 'SIGKILL')
    expect(processKill).not.toHaveBeenCalledWith(secondChildPid, 'SIGKILL')
    expect(subject.live.pty.kill).not.toHaveBeenCalledWith('SIGKILL')
  })

  it('force-signals a freshly verified POSIX root by native birth identity after descendants', async () => {
    const platform = process.platform
    const subject = makeSubject('detached-worker')
    const deadline = Date.now() + 1_000
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })

    try {
      await forceValidatedTree(
        subject.live,
        [ROOT_PID, CHILD_PID].map((pid) => ({ pid, startedAt: `start-${pid}` })),
        { whenExited: new Promise(() => undefined), exitCode: null },
        true,
        deadline,
      )

      expect(probes.signalTerminalProcessIdentity).toHaveBeenNthCalledWith(
        1,
        { pid: CHILD_PID, startedAt: `start-${CHILD_PID}` },
        'SIGKILL',
      )
      expect(probes.signalTerminalProcessIdentity).toHaveBeenNthCalledWith(
        2,
        { pid: ROOT_PID, startedAt: `start-${ROOT_PID}` },
        'SIGKILL',
      )
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    }
  })

  it('uses the PTY descriptor close to stop a stubborn tty-attached child', async () => {
    const subject = makeSubject('stubborn-flood')
    let childAlive = true
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        childAlive
          ? table(row(ROOT_PID, 1, 'zsh'), row(CHILD_PID, ROOT_PID, 'stubborn-flood'))
          : new Map(),
      ),
    )
    subject.destroy.mockImplementation(() => {
      childAlive = false
    })
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === CHILD_PID && signal === 0 && !childAlive) throw missingProcessError()
      return true
    })

    await expect(shutdownLiveTerminal(subject.record, vi.fn())).resolves.toBe(true)

    expect(subject.destroy).toHaveBeenCalledOnce()
    expect(subject.publicDestroy).not.toHaveBeenCalled()
    expect(subject.record.live).toBeNull()
  })

  it('confirms absent known processes without another slow table probe after the tty closes', async () => {
    const subject = makeSubject('stubborn-flood')
    probes.readProcessTable.mockResolvedValue(null)
    subject.destroy.mockImplementation(() => {
      subject.record.termination?.notifyExit(0)
    })
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if ((pid === ROOT_PID || pid === CHILD_PID) && signal === 0) throw missingProcessError()
      return true
    })

    const shutdown = shutdownLiveTerminal(subject.record, vi.fn())

    await expect(shutdown).resolves.toBe(true)
    expect(probes.readProcessTable).toHaveBeenCalledOnce()
    expect(subject.destroy).toHaveBeenCalledOnce()
    expect(subject.record.live).toBeNull()
  })

  it('fails closed when a known pid remains after the tty closes and table probes are unavailable', async () => {
    const subject = makeSubject('detached-worker')
    probes.readProcessTable.mockResolvedValue(null)
    subject.destroy.mockImplementation(() => {
      subject.record.termination?.notifyExit(0)
    })
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === ROOT_PID && signal === 0) throw missingProcessError()
      return true
    })

    await expect(shutdownLiveTerminal(subject.record, vi.fn())).resolves.toBe(false)

    expect(probes.readProcessTable.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(subject.record.live).toBe(subject.live)
  })

  it('fails closed when a cached detached child survives the PTY descriptor close', async () => {
    const subject = makeSubject('detached-worker')
    probes.readProcessTable.mockResolvedValue(table(row(CHILD_PID, 1, 'detached-worker')))
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(subject.record, vi.fn())).resolves.toBe(false)

    expect(subject.destroy).toHaveBeenCalledOnce()
    expect(subject.record.live).toBe(subject.live)
  })

  it('force-kills a freshly validated detached child before accepting the closed tty', async () => {
    const subject = makeSubject('detached-worker')
    probes.readProcessTable.mockResolvedValue(
      table(row(ROOT_PID, 1, 'zsh'), row(CHILD_PID, 1, 'detached-worker')),
    )
    let childAlive = true
    probes.signalTerminalProcessIdentity.mockImplementation((identity: { pid: number }) => {
      if (identity.pid !== CHILD_PID) return 'unavailable'
      childAlive = false
      return 'signaled'
    })
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        childAlive
          ? table(row(ROOT_PID, 1, 'zsh'), row(CHILD_PID, 1, 'detached-worker'))
          : new Map(),
      ),
    )
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(subject.record, vi.fn())).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: CHILD_PID, startedAt: `start-${CHILD_PID}` },
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(CHILD_PID, 'SIGKILL')
    expect(subject.destroy).toHaveBeenCalledOnce()
    expect(subject.record.live).toBeNull()
  })

  it('accepts a freshly observed zombie without spending the force wait budget', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const subject = makeSubject('finished-flood')
    subject.live.tty = null
    if (subject.record.activity !== null) {
      subject.record.activity = { ...subject.record.activity, tty: null }
    }
    probes.readProcessTable
      .mockResolvedValueOnce(null)
      .mockResolvedValue(table({ ...row(CHILD_PID, 1, 'finished-flood'), zombie: true }))
    subject.destroy.mockImplementation(() => {
      subject.record.termination?.notifyExit(0)
    })
    vi.spyOn(process, 'kill').mockReturnValue(true)
    let settled = false

    const shutdown = shutdownLiveTerminal(subject.record, vi.fn()).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(1)

    await expect(shutdown).resolves.toBe(true)
    expect(settled).toBe(true)
    expect(Date.now() - startedAt).toBe(1)
    expect(probes.readProcessTable).toHaveBeenCalledTimes(2)
    expect(subject.record.live).toBeNull()
  })
})
