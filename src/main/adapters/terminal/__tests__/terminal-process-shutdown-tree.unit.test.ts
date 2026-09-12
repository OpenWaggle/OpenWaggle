import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EARLY_CHILD_PID,
  getTerminalProcessShutdownProbes,
  identities,
  LATE_CHILD_PID,
  makeLiveProcess,
  makeRecord,
  missingProcessError,
  ROOT_PID,
  refreshTerminalProcessPids,
  row,
  setupTerminalProcessShutdownTest,
  shutdownLiveTerminal,
  table,
  teardownTerminalProcessShutdownTest,
} from './terminal-process-shutdown-test-harness'

const probes = getTerminalProcessShutdownProbes()

describe('terminal process-tree shutdown membership', () => {
  beforeEach(setupTerminalProcessShutdownTest)
  afterEach(teardownTerminalProcessShutdownTest)

  it('accepts a zombie descendant as exited after the root PTY exits', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'finished-worker',
      processNames: ['finished-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    probes.readProcessTable.mockResolvedValue(
      table(row(ROOT_PID, 1, 'zsh'), row(EARLY_CHILD_PID, ROOT_PID, 'finished-worker', true)),
    )
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(record.live).toBeNull()
  })

  it('prunes a cached descendant that is absent from a reliable post-signal table', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'finished-worker',
      processNames: ['finished-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    probes.readProcessTable.mockResolvedValue(table(row(ROOT_PID, 1, 'zsh')))
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGHUP')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
  })

  it('retains a reparented process that is still attached to the terminal tty', async () => {
    probes.readProcessTable.mockResolvedValue(
      table({
        ...row(LATE_CHILD_PID, 1, 'reparented-worker'),
        tty: 'ttys123',
        ttyIdentity: 'darwin:16:123',
      }),
    )

    const refreshed = await refreshTerminalProcessPids(
      ROOT_PID,
      [ROOT_PID],
      identities(ROOT_PID),
      'ttys123',
      'darwin:16:123',
      false,
    )

    expect(refreshed.reliable).toBe(true)
    expect(refreshed.processPids).toEqual([LATE_CHILD_PID])
    expect(refreshed.ttyProcessPids).toEqual([LATE_CHILD_PID])
  })

  it('confirms a closed tty from exact pid absence without a second table process', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: null,
      processNames: [],
      ports: [],
      processPids: [ROOT_PID],
      processIdentities: identities(ROOT_PID),
      tty: 'openwaggle-definitely-closed-test-tty',
      processReliable: true,
      reliable: true,
    }
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === ROOT_PID && signal === 0) throw missingProcessError()
      return true
    })
    probes.readProcessTable
      .mockResolvedValueOnce(table({ ...row(ROOT_PID, 1, 'zsh'), tty: record.activity.tty }))
      .mockResolvedValue(new Map())

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.readProcessTable).toHaveBeenCalledOnce()
    expect(record.live).toBeNull()
  })

  it('signals exact live tty members before closing a process-table-unavailable PTY', async () => {
    const fake = makeLiveProcess()
    fake.live.tty = 'ttys123'
    const record = makeRecord(fake.live)
    if (record.activity !== null) record.activity = { ...record.activity, tty: 'ttys123' }
    let ttyMemberAlive = true
    probes.readProcessTable.mockResolvedValue(null)
    probes.signalLiveTerminalTtyMembers.mockImplementation(() => {
      ttyMemberAlive = false
      record.termination?.notifyExit(0)
      return 'signaled'
    })
    fake.destroy.mockImplementation(() => record.termination?.notifyExit(0))
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === ROOT_PID && signal === 0 && !ttyMemberAlive) throw missingProcessError()
      return true
    })

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.signalLiveTerminalTtyMembers).toHaveBeenCalledOnce()
    expect(probes.signalLiveTerminalTtyMembers.mock.invocationCallOrder[0]).toBeLessThan(
      fake.destroy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.destroy).not.toHaveBeenCalled()
    expect(record.live).toBeNull()
  })

  it('does not let a native no-match result suppress a detached child fallback', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'detached-worker',
      processNames: ['detached-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    let childAlive = true
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(childAlive ? table(row(EARLY_CHILD_PID, 1, 'detached-worker')) : new Map()),
    )
    probes.signalLiveTerminalTtyMembers.mockImplementation(() => {
      record.termination?.notifyExit(0)
      return 'no-match'
    })
    probes.signalTerminalProcessIdentity.mockImplementation((identity) => {
      if (identity.pid !== EARLY_CHILD_PID) return 'unavailable'
      childAlive = false
      return 'signaled'
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: EARLY_CHILD_PID, startedAt: `start-${EARLY_CHILD_PID}` },
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(record.live).toBeNull()
  })

  it('birth-checks a child that detached between the tty snapshot and native sweep', async () => {
    const fake = makeLiveProcess()
    fake.live.tty = 'ttys123'
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'detached-worker',
      processNames: ['detached-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: 'ttys123',
      processReliable: true,
      reliable: true,
    }
    let childAlive = true
    let nativeSweepRan = false
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        table(
          { ...row(ROOT_PID, 1, 'zsh'), tty: 'ttys123' },
          ...(childAlive
            ? [
                {
                  ...row(EARLY_CHILD_PID, 1, 'detached-worker'),
                  tty: nativeSweepRan ? null : 'ttys123',
                },
              ]
            : []),
        ),
      ),
    )
    probes.signalLiveTerminalTtyMembers
      .mockReturnValueOnce('unavailable')
      .mockImplementation(() => {
        nativeSweepRan = true
        record.termination?.notifyExit(0)
        return 'signaled'
      })
    probes.signalTerminalProcessIdentity.mockImplementation((identity) => {
      if (identity.pid !== EARLY_CHILD_PID) return 'unavailable'
      childAlive = false
      return 'signaled'
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: EARLY_CHILD_PID, startedAt: `start-${EARLY_CHILD_PID}` },
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(fake.kill).not.toHaveBeenCalled()
    expect(record.live).toBeNull()
  })

  it('prunes a recycled cached pid before signaling or waiting on it', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'old-worker',
      processNames: ['old-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    probes.readProcessTable.mockResolvedValue(
      table(row(ROOT_PID, 1, 'zsh'), {
        ...row(EARLY_CHILD_PID, 1, 'unrelated'),
        startedAt: 'recycled-process',
      }),
    )
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGHUP')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGHUP')
    expect(record.live).toBeNull()
  })
})
