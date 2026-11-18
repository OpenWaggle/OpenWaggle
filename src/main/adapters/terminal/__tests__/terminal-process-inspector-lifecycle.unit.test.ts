import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({
  readProcessTable: vi.fn(),
  readListeningPorts: vi.fn(),
}))

vi.mock('../terminal-process-probes', () => ({
  NO_TTY_FOREGROUND_GROUP: -1,
  parsePosixRow: vi.fn(),
  hydratePosixProcessRows: (rows: Map<number, unknown>) => new Map(rows),
  readProcessTable: probes.readProcessTable,
  readListeningPorts: probes.readListeningPorts,
}))

const { makeTerminalProcessInspector } = await import('../terminal-process-inspector')

function shellTable() {
  return new Map([
    [
      100,
      {
        pid: 100,
        ppid: 1,
        pgid: 100,
        tpgid: 100,
        tty: 'ttys001',
        ttyIdentity: 'darwin:16:1',
        identityVerified: true,
        zombie: false,
        startedAt: 'start-100',
        name: 'zsh',
      },
    ],
  ])
}

function target(pid = 100, tty = 'ttys001', ttyIdentity = 'darwin:16:1') {
  return {
    key: `session-1::${pid === 100 ? 'main' : 'side'}`,
    pid,
    tty,
    ttyIdentity,
    processIdentity: { pid, startedAt: `start-${pid}` },
  }
}

describe('terminal process inspector polling lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    probes.readProcessTable.mockReset()
    probes.readProcessTable.mockResolvedValue(shellTable())
    probes.readListeningPorts.mockReset()
    probes.readListeningPorts.mockResolvedValue(new Map())
  })

  afterEach(() => vi.useRealTimers())

  it('does not install an idle interval and stops polling when the last target leaves', async () => {
    const inspector = makeTerminalProcessInspector()
    inspector.start(vi.fn())

    expect(vi.getTimerCount()).toBe(0)
    expect(probes.readProcessTable).not.toHaveBeenCalled()

    inspector.setTargets([target()])
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    expect(probes.readProcessTable).toHaveBeenCalledOnce()

    inspector.setTargets([])
    const callsAfterClear = probes.readProcessTable.mock.calls.length
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(probes.readProcessTable).toHaveBeenCalledTimes(callsAfterClear)
    inspector.stop()
  })

  it('starts an immediate tick when targets were registered before the listener', async () => {
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()
    inspector.setTargets([target()])

    expect(vi.getTimerCount()).toBe(0)
    expect(probes.readProcessTable).not.toHaveBeenCalled()

    inspector.start(onActivity)
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(1)
    expect(probes.readProcessTable).toHaveBeenCalledOnce()
    expect(onActivity).toHaveBeenCalledWith(
      'session-1::main',
      expect.objectContaining({ processName: null, processNames: [], processReliable: true }),
    )
    inspector.stop()
  })

  it('keeps process reliability when the independent listening-port probe fails', async () => {
    probes.readListeningPorts.mockResolvedValueOnce(null)
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()

    inspector.start(onActivity)
    inspector.setTargets([target()])
    await vi.advanceTimersByTimeAsync(0)

    expect(onActivity).toHaveBeenCalledWith(
      'session-1::main',
      expect.objectContaining({
        processName: null,
        processNames: [],
        processReliable: true,
        reliable: false,
      }),
    )
    inspector.stop()
  })

  it('shares one process-table and port probe across multiple terminals in one tick', async () => {
    const rows = shellTable()
    rows.set(200, {
      pid: 200,
      ppid: 1,
      pgid: 200,
      tpgid: 200,
      tty: 'ttys002',
      ttyIdentity: 'darwin:16:2',
      identityVerified: true,
      zombie: false,
      startedAt: 'start-200',
      name: 'zsh',
    })
    probes.readProcessTable.mockResolvedValue(rows)
    probes.readListeningPorts.mockResolvedValue(
      new Map([
        [100, [3000]],
        [200, [4000]],
      ]),
    )
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()

    inspector.start(onActivity)
    inspector.setTargets([target(), target(200, 'ttys002', 'darwin:16:2')])
    await vi.advanceTimersByTimeAsync(0)

    expect(probes.readProcessTable).toHaveBeenCalledOnce()
    expect(probes.readProcessTable).toHaveBeenCalledWith()
    expect(probes.readListeningPorts).toHaveBeenCalledExactlyOnceWith([100, 200])
    expect(onActivity).toHaveBeenCalledTimes(2)
    expect(onActivity).toHaveBeenCalledWith(
      'session-1::main',
      expect.objectContaining({ ports: [3000] }),
    )
    expect(onActivity).toHaveBeenCalledWith(
      'session-1::side',
      expect.objectContaining({ ports: [4000] }),
    )
    inspector.stop()
  })

  it('observes every successful process sample while suppressing unchanged activity', async () => {
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()
    const onObservation = vi.fn()
    inspector.observe(onObservation)
    inspector.start(onActivity)
    inspector.setTargets([target()])

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onActivity).toHaveBeenCalledOnce()
    expect(onObservation).toHaveBeenCalledTimes(2)
    inspector.stop()
  })
})
