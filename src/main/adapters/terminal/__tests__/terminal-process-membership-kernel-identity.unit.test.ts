import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessRow } from '../terminal-process-probes'

const probes = vi.hoisted(() => ({ readProcessTable: vi.fn() }))

vi.mock('../terminal-process-probes', () => ({
  readProcessTable: probes.readProcessTable,
}))

const { refreshTerminalProcessPids } = await import('../terminal-process-tree')

const ROOT_PID = 100
const CHILD_PID = 200
const TTY = 'ttys001'
const TTY_IDENTITY = 'darwin:16:1'

function row(pid: number, startedAt: string, ttyIdentity: string | null, ppid = 1): ProcessRow {
  return {
    pid,
    ppid,
    pgid: pid,
    tpgid: pid,
    tty: TTY,
    ttyIdentity,
    identityVerified: true,
    zombie: false,
    startedAt,
    name: pid === ROOT_PID ? 'zsh' : 'worker',
  }
}

describe('terminal process membership kernel identity', () => {
  beforeEach(() => probes.readProcessTable.mockReset())

  it('retains a prior exact identity after the process is reparented', async () => {
    probes.readProcessTable.mockResolvedValue(
      new Map([[CHILD_PID, row(CHILD_PID, 'start-child', TTY_IDENTITY)]]),
    )

    const result = await refreshTerminalProcessPids(
      ROOT_PID,
      [ROOT_PID, CHILD_PID],
      [
        { pid: ROOT_PID, startedAt: 'start-root' },
        { pid: CHILD_PID, startedAt: 'start-child' },
      ],
      TTY,
      TTY_IDENTITY,
      false,
    )

    expect(result.processPids).toEqual([CHILD_PID])
    expect(result.processIdentities).toEqual([{ pid: CHILD_PID, startedAt: 'start-child' }])
    expect(result.ttyProcessPids).toEqual([CHILD_PID])
  })

  it('rejects a reparented process with matching tty text but a different device identity', async () => {
    probes.readProcessTable.mockResolvedValue(
      new Map([[CHILD_PID, row(CHILD_PID, 'start-unrelated', 'darwin:16:2')]]),
    )

    const result = await refreshTerminalProcessPids(
      ROOT_PID,
      [ROOT_PID],
      [{ pid: ROOT_PID, startedAt: 'start-root' }],
      TTY,
      TTY_IDENTITY,
      false,
    )

    expect(result.processPids).toEqual([])
    expect(result.processIdentities).toEqual([])
    expect(result.ttyProcessPids).toEqual([])
  })

  it('rejects a cached pid when its token changes despite an exact tty device match', async () => {
    probes.readProcessTable.mockResolvedValue(
      new Map([[CHILD_PID, row(CHILD_PID, 'start-reused', TTY_IDENTITY)]]),
    )

    const result = await refreshTerminalProcessPids(
      ROOT_PID,
      [ROOT_PID, CHILD_PID],
      [
        { pid: ROOT_PID, startedAt: 'start-root' },
        { pid: CHILD_PID, startedAt: 'start-child' },
      ],
      TTY,
      TTY_IDENTITY,
      false,
    )

    expect(result.processPids).toEqual([])
    expect(result.processIdentities).toEqual([])
    expect(result.ttyProcessPids).toEqual([])
  })
})
