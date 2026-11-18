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

const OLD_KEY = 'session-1::main'
const NEW_KEY = 'session-1::moved'
const PID = 100

function shellTable(ttyIdentity: string) {
  return new Map([
    [
      PID,
      {
        pid: PID,
        ppid: 1,
        pgid: PID,
        tpgid: PID,
        tty: 'ttys001',
        ttyIdentity,
        identityVerified: true,
        zombie: false,
        startedAt: 'start-100',
        name: 'zsh',
      },
    ],
  ])
}

function target(key: string, ttyIdentity: string) {
  return {
    key,
    pid: PID,
    tty: 'ttys001',
    ttyIdentity,
    processIdentity: { pid: PID, startedAt: 'start-100' },
  }
}

describe('terminal process inspector target identity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    probes.readProcessTable.mockReset()
    probes.readListeningPorts.mockReset()
    probes.readListeningPorts.mockResolvedValue(new Map())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not transfer a snapshot to the same tty text on a different device identity', async () => {
    probes.readProcessTable
      .mockResolvedValueOnce(shellTable('darwin:16:1'))
      .mockResolvedValueOnce(null)
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()
    inspector.start(onActivity)
    inspector.setTargets([target(OLD_KEY, 'darwin:16:1')])
    await vi.advanceTimersByTimeAsync(0)

    inspector.setTargets([target(NEW_KEY, 'darwin:16:2')])
    await vi.advanceTimersByTimeAsync(0)

    expect(onActivity).toHaveBeenLastCalledWith(
      NEW_KEY,
      expect.objectContaining({
        processPids: [],
        processIdentities: [],
        processReliable: false,
      }),
    )
    inspector.stop()
  })

  it('discards a completed sample when its target was replaced while the probe was in flight', async () => {
    let resolveRows: ((rows: ReturnType<typeof shellTable>) => void) | undefined
    probes.readProcessTable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve
        }),
    )
    const inspector = makeTerminalProcessInspector()
    const onActivity = vi.fn()
    inspector.start(onActivity)
    inspector.setTargets([target(OLD_KEY, 'darwin:16:1')])
    inspector.setTargets([target(OLD_KEY, 'darwin:16:2')])
    resolveRows?.(shellTable('darwin:16:1'))
    // Do not run the queued replacement tick before inspecting the stale result.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(onActivity).not.toHaveBeenCalled()
    probes.readProcessTable.mockResolvedValue(shellTable('darwin:16:2'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onActivity).toHaveBeenCalledOnce()
    inspector.stop()
  })

  it('does not publish into a restarted inspector from an old in-flight sample', async () => {
    let resolveRows: ((rows: ReturnType<typeof shellTable>) => void) | undefined
    probes.readProcessTable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve
        }),
    )
    const inspector = makeTerminalProcessInspector()
    inspector.start(vi.fn())
    inspector.setTargets([target(OLD_KEY, 'darwin:16:1')])
    inspector.stop()
    const onActivity = vi.fn()
    inspector.start(onActivity)
    inspector.setTargets([target(OLD_KEY, 'darwin:16:1')])
    resolveRows?.(shellTable('darwin:16:1'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(onActivity).not.toHaveBeenCalled()
    inspector.stop()
  })
})
