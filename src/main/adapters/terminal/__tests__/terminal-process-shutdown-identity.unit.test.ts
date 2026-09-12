import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EARLY_CHILD_PID,
  getTerminalProcessShutdownProbes,
  makeLiveProcess,
  makeRecord,
  ROOT_PID,
  row,
  setupTerminalProcessShutdownTest,
  shutdownLiveTerminal,
  table,
  teardownTerminalProcessShutdownTest,
} from './terminal-process-shutdown-test-harness'

const probes = getTerminalProcessShutdownProbes()

describe('terminal process-tree shutdown identity safety', () => {
  beforeEach(setupTerminalProcessShutdownTest)
  afterEach(teardownTerminalProcessShutdownTest)

  it('does not adopt descendants from a root pid recycled before its first identity sample', async () => {
    const fake = makeLiveProcess(ROOT_PID, Promise.resolve(null))
    const record = makeRecord(fake.live)
    record.activity = null
    probes.readProcessTable.mockResolvedValue(
      table(
        { ...row(ROOT_PID, 1, 'unrelated-root'), startedAt: 'recycled-root' },
        row(EARLY_CHILD_PID, ROOT_PID, 'unrelated-child'),
      ),
    )
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGHUP')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 0)
    expect(record.live).toBeNull()
  })

  it('does not let a later inspector identity substitute for missing spawn identity', async () => {
    const fake = makeLiveProcess(ROOT_PID, Promise.resolve(null))
    fake.live.processIdentity = null
    const record = makeRecord(fake.live)
    probes.readProcessTable.mockResolvedValue(table(row(ROOT_PID, 1, 'zsh')))
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(false)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.destroy).toHaveBeenCalledOnce()
    expect(fake.publicDestroy).not.toHaveBeenCalled()
    expect(record.live).toBe(fake.live)
  })

  it('treats a captured root birth mismatch as proof that the original root exited', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    probes.readProcessTable.mockResolvedValue(
      table(
        { ...row(ROOT_PID, 1, 'unrelated-root'), startedAt: 'recycled-root' },
        row(EARLY_CHILD_PID, ROOT_PID, 'unrelated-child'),
      ),
    )
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.destroy).toHaveBeenCalledOnce()
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGHUP')
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(record.live).toBeNull()
  })

  it('never sends a raw root signal when the root identity changes during shutdown', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    probes.readProcessTable
      .mockResolvedValueOnce(table(row(ROOT_PID, 1, 'zsh')))
      .mockResolvedValue(
        table({ ...row(ROOT_PID, 1, 'unrelated-root'), startedAt: 'recycled-root' }),
      )
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.destroy).toHaveBeenCalledOnce()
  })

  it('uses descriptor closure instead of raw signals for a matching root identity', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    probes.readProcessTable.mockResolvedValue(table(row(ROOT_PID, 1, 'zsh')))
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.destroy).toHaveBeenCalledOnce()
    expect(record.live).toBeNull()
  })

  it('revalidates a descendant birth identity immediately before the forced signal', async () => {
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'detached-worker',
      processNames: ['detached-worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: [ROOT_PID, EARLY_CHILD_PID].map((pid) => ({
        pid,
        startedAt: `start-${pid}`,
      })),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    probes.readProcessTable.mockResolvedValue(
      table(row(ROOT_PID, 1, 'zsh'), row(EARLY_CHILD_PID, 1, 'detached-worker')),
    )
    probes.signalTerminalProcessIdentity.mockImplementation((identity) =>
      identity.pid === EARLY_CHILD_PID ? 'mismatch' : 'unavailable',
    )
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(false)

    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: EARLY_CHILD_PID, startedAt: `start-${EARLY_CHILD_PID}` },
      'SIGKILL',
    )
    expect(fake.kill).not.toHaveBeenCalled()
    expect(record.live).toBe(fake.live)
  })
})
