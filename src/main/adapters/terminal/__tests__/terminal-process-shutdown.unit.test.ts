import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_SPAWN_PROCESS_METADATA_MS } from '../terminal-process-identity'
import type { ProcessRow } from '../terminal-process-inspector'
import {
  EARLY_CHILD_PID,
  getTerminalProcessShutdownProbes,
  identities,
  LATE_CHILD_PID,
  makeLiveProcess,
  makeRecord,
  makeRetainedProcess,
  ROOT_PID,
  row,
  setupTerminalProcessShutdownTest,
  shutdownDetachedTerminal,
  shutdownLiveTerminal,
  TERMINAL_FORCE_SHUTDOWN_MS,
  TERMINAL_GRACEFUL_SHUTDOWN_MS,
  TERMINAL_SHUTDOWN_PIPELINE_MS,
  table,
  teardownTerminalProcessShutdownTest,
} from './terminal-process-shutdown-test-harness'

const probes = getTerminalProcessShutdownProbes()
const TEST_TTY = 'ptmx'
const TEST_TTY_IDENTITY = 'linux:136:71'

function giveExactTty(live: ReturnType<typeof makeLiveProcess>['live']) {
  live.tty = TEST_TTY
  Object.defineProperty(live, 'ttyIdentity', { value: TEST_TTY_IDENTITY })
}

function rootRow(name = 'zsh') {
  return { ...row(ROOT_PID, 1, name), tty: TEST_TTY, ttyIdentity: TEST_TTY_IDENTITY }
}

describe('terminal process-tree shutdown orchestration', () => {
  beforeEach(setupTerminalProcessShutdownTest)
  afterEach(teardownTerminalProcessShutdownTest)

  it('keeps graceful and force work inside the internal shutdown deadline', () => {
    expect(TERMINAL_GRACEFUL_SHUTDOWN_MS + TERMINAL_FORCE_SHUTDOWN_MS).toBe(
      TERMINAL_SHUTDOWN_PIPELINE_MS,
    )
    expect(TERMINAL_SPAWN_PROCESS_METADATA_MS + TERMINAL_SHUTDOWN_PIPELINE_MS).toBeLessThanOrEqual(
      250,
    )
  })

  it('uses the targeted spawn identity to protect an immediate close before inspection', async () => {
    const fake = makeLiveProcess(
      ROOT_PID,
      Promise.resolve({
        pid: ROOT_PID,
        startedAt: `start-${ROOT_PID}`,
        tty: null,
        ttyIdentity: null,
      }),
    )
    giveExactTty(fake.live)
    const record = makeRecord(fake.live)
    record.activity = null
    let childAlive = true
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        childAlive ? table(rootRow(), row(EARLY_CHILD_PID, ROOT_PID, 'early-worker')) : new Map(),
      ),
    )
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

  it('refreshes and force-kills a child forked while the root handles SIGHUP', async () => {
    const fake = makeLiveProcess()
    giveExactTty(fake.live)
    const record = makeRecord(fake.live)
    let handledHup = false
    let lateChildKilled = false
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        handledHup
          ? table(
              { ...rootRow(), zombie: true },
              ...(lateChildKilled ? [] : [row(LATE_CHILD_PID, ROOT_PID, 'late-worker')]),
            )
          : table(rootRow()),
      ),
    )
    probes.signalLiveTerminalTtyMembers.mockImplementationOnce(() => {
      handledHup = true
      fake.emitExit(0)
      return 'signaled'
    })
    probes.signalTerminalProcessIdentity.mockImplementation((identity) => {
      if (identity.pid !== LATE_CHILD_PID) return 'unavailable'
      lateChildKilled = true
      return 'signaled'
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: LATE_CHILD_PID, startedAt: `start-${LATE_CHILD_PID}` },
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(LATE_CHILD_PID, 'SIGKILL')
    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.live.pauseOutput).toHaveBeenCalledOnce()
    expect(record.live).toBeNull()
  })

  it('inspects and kills descendants of a detached stale spawn', async () => {
    const fake = makeLiveProcess(
      ROOT_PID,
      Promise.resolve({
        pid: ROOT_PID,
        startedAt: `start-${ROOT_PID}`,
        tty: null,
        ttyIdentity: null,
      }),
    )
    giveExactTty(fake.live)
    let childAlive = true
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        childAlive
          ? table(rootRow(), row(EARLY_CHILD_PID, ROOT_PID, 'background-worker'))
          : new Map(),
      ),
    )
    probes.signalTerminalProcessIdentity.mockImplementation((identity) => {
      if (identity.pid !== EARLY_CHILD_PID) return 'unavailable'
      childAlive = false
      return 'signaled'
    })
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownDetachedTerminal(makeRetainedProcess(fake.live))).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).toHaveBeenCalledWith(
      { pid: EARLY_CHILD_PID, startedAt: `start-${EARLY_CHILD_PID}` },
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(EARLY_CHILD_PID, 'SIGKILL')
    expect(probes.signalLiveTerminalTtyMembers).toHaveBeenNthCalledWith(1, fake.live, false)
    expect(probes.signalLiveTerminalTtyMembers).toHaveBeenNthCalledWith(2, fake.live, true)
    expect(probes.readProcessTable.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(fake.live.pauseOutput).toHaveBeenCalledOnce()
    expect(fake.live.resumeOutput).toHaveBeenCalledOnce()
    expect(fake.live.outputPaused).toBe(false)
  })

  it('resumes a backpressured detached PTY after tree proof so its finite tail can drain', async () => {
    const fake = makeLiveProcess()
    giveExactTty(fake.live)
    fake.live.outputPaused = true
    probes.readProcessTable.mockResolvedValue(new Map())
    fake.emitExit(0)

    await expect(shutdownDetachedTerminal(makeRetainedProcess(fake.live))).resolves.toBe(true)

    expect(fake.live.pauseOutput).not.toHaveBeenCalled()
    expect(fake.live.resumeOutput).toHaveBeenCalledOnce()
    expect(fake.live.outputPaused).toBe(false)
  })

  it('retains root-exit evidence when a later reliable retry must finish confirmation', async () => {
    vi.useFakeTimers()
    const fake = makeLiveProcess()
    const record = makeRecord(fake.live)
    record.activity = {
      processName: 'worker',
      processNames: ['worker'],
      ports: [],
      processPids: [ROOT_PID, EARLY_CHILD_PID],
      processIdentities: identities(ROOT_PID, EARLY_CHILD_PID),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    probes.readProcessTable
      .mockResolvedValueOnce(
        table(row(ROOT_PID, 1, 'zsh'), row(EARLY_CHILD_PID, ROOT_PID, 'worker')),
      )
      .mockResolvedValue(null)
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') record.termination?.notifyExit(0)
    })
    vi.spyOn(process, 'kill').mockReturnValue(true)

    const first = shutdownLiveTerminal(record, vi.fn())
    await vi.advanceTimersByTimeAsync(TERMINAL_GRACEFUL_SHUTDOWN_MS + TERMINAL_FORCE_SHUTDOWN_MS)
    await expect(first).resolves.toBe(false)
    expect(record.exitCode).toBe(0)
    expect(record.live).toBe(fake.live)

    probes.readProcessTable.mockResolvedValue(table(row(999_999, 1, 'unrelated')))
    const retry = shutdownLiveTerminal(record, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await expect(retry).resolves.toBe(true)
    expect(record.live).toBeNull()
  })

  it('carries a child discovered by one retained attempt into the next retry', async () => {
    const fake = makeLiveProcess()
    giveExactTty(fake.live)
    const target = makeRetainedProcess(fake.live)
    probes.readProcessTable
      .mockResolvedValueOnce(
        table(rootRow(), row(EARLY_CHILD_PID, ROOT_PID, 'new-background-worker')),
      )
      .mockResolvedValue(null)
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownDetachedTerminal(target)).resolves.toBe(false)
    expect(target.processPids).toContain(EARLY_CHILD_PID)
    expect(target.processIdentities).toContainEqual({
      pid: EARLY_CHILD_PID,
      startedAt: `start-${EARLY_CHILD_PID}`,
    })

    probes.readProcessTable.mockResolvedValue(new Map())
    await expect(shutdownDetachedTerminal(target)).resolves.toBe(true)
  })

  it('keeps an unidentified live pid as a fail-closed obligation without signaling it', async () => {
    const fake = makeLiveProcess()
    const unidentifiedPid = EARLY_CHILD_PID
    const target = makeRetainedProcess(fake.live, [ROOT_PID, unidentifiedPid])
    probes.readProcessTable.mockResolvedValue(table(row(unidentifiedPid, 1, 'unknown-worker')))
    fake.emitExit(0)
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownDetachedTerminal(target)).resolves.toBe(false)

    expect(target.processPids).toContain(unidentifiedPid)
    expect(probes.signalTerminalProcessIdentity).not.toHaveBeenCalledWith(
      expect.objectContaining({ pid: unidentifiedPid }),
      'SIGKILL',
    )
    expect(processKill).not.toHaveBeenCalledWith(unidentifiedPid, 'SIGKILL')
  })

  it('does not claim success when the final process-tree proof is unavailable', async () => {
    const fake = makeLiveProcess(
      ROOT_PID,
      Promise.resolve({
        pid: ROOT_PID,
        startedAt: `start-${ROOT_PID}`,
        tty: null,
        ttyIdentity: null,
      }),
    )
    probes.readProcessTable
      .mockResolvedValueOnce(
        table(row(ROOT_PID, 1, 'zsh'), row(EARLY_CHILD_PID, ROOT_PID, 'worker')),
      )
      .mockResolvedValue(null)
    fake.kill.mockImplementation((signal) => {
      if (signal === 'SIGHUP') fake.emitExit(0)
    })
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownDetachedTerminal(makeRetainedProcess(fake.live))).resolves.toBe(false)

    expect(fake.kill).not.toHaveBeenCalled()
    expect(fake.live.pauseOutput).toHaveBeenCalledOnce()
    expect(fake.live.resumeOutput).toHaveBeenCalledOnce()
    expect(fake.live.outputPaused).toBe(false)
    expect(fake.destroy).toHaveBeenCalledOnce()
  })

  it('keeps probe retries inside the graceful-plus-force shutdown budget', async () => {
    vi.useFakeTimers()
    const fake = makeLiveProcess(
      ROOT_PID,
      Promise.resolve({
        pid: ROOT_PID,
        startedAt: `start-${ROOT_PID}`,
        tty: null,
        ttyIdentity: null,
      }),
    )
    const neverCompletes = new Promise<Map<number, ProcessRow>>(() => undefined)
    probes.readProcessTable
      .mockResolvedValueOnce(table(row(ROOT_PID, 1, 'zsh')))
      .mockReturnValue(neverCompletes)
    vi.spyOn(process, 'kill').mockReturnValue(true)
    let settled = false

    const shutdown = shutdownDetachedTerminal(makeRetainedProcess(fake.live)).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(
      TERMINAL_GRACEFUL_SHUTDOWN_MS + TERMINAL_FORCE_SHUTDOWN_MS - 1,
    )
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(shutdown).resolves.toBe(false)
    expect(fake.kill).not.toHaveBeenCalled()
  })
})
