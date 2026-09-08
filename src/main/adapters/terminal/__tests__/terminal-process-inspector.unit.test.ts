import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectDescendants,
  type ProcessRow,
  parsePosixRow,
  resolveForegroundName,
} from '../terminal-process-inspector'
import { parsePosixProcessMetadataRow, readProcessTty } from '../terminal-process-probes'
import { refreshTerminalProcessPids } from '../terminal-process-tree'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

function row(pid: number, ppid: number, pgid: number, tpgid: number, name: string): ProcessRow {
  return {
    pid,
    ppid,
    pgid,
    tpgid,
    tty: 'ttys001',
    ttyIdentity: 'darwin:16:1',
    identityVerified: true,
    zombie: false,
    startedAt: `start-${pid}`,
    name,
  }
}

function table(...rows: readonly ProcessRow[]) {
  return new Map(rows.map((entry) => [entry.pid, entry]))
}

describe('terminal process inspector', () => {
  afterEach(() => {
    execFileMock.mockReset()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('parsePosixRow', () => {
    it('parses pid, ppid, pgid, tpgid, and a command name with spaces', () => {
      // macOS comm values like "Google Chrome Helper" contain spaces, so the
      // parser joins every column after tpgid into the name.
      expect(
        parsePosixRow(
          '  42   7  42  99 ttys001 S+ Fri Sep 4 22:18:37 2026 /usr/local/bin/node server.js',
        ),
      ).toEqual({
        pid: 42,
        ppid: 7,
        pgid: 42,
        tpgid: 99,
        tty: 'ttys001',
        ttyIdentity: null,
        identityVerified: false,
        zombie: false,
        startedAt: 'Fri Sep 4 22:18:37 2026',
        name: 'node server.js',
      })
    })

    it('identifies an exited process awaiting reaping', () => {
      expect(
        parsePosixRow('  42   7  42  99 ttys001 Z+ Fri Sep 4 22:18:37 2026 /usr/local/bin/node'),
      ).toEqual({
        pid: 42,
        ppid: 7,
        pgid: 42,
        tpgid: 99,
        tty: 'ttys001',
        ttyIdentity: null,
        identityVerified: false,
        zombie: true,
        startedAt: 'Fri Sep 4 22:18:37 2026',
        name: 'node',
      })
    })

    it('rejects header fragments and short rows', () => {
      expect(parsePosixRow('')).toBeNull()
      expect(parsePosixRow('ps header junk')).toBeNull()
      expect(parsePosixRow('abc def ghi jkl tty S name')).toBeNull()
    })

    it('parses a targeted spawn identity and normalizes a missing Linux tty', () => {
      expect(parsePosixProcessMetadataRow(42, '? Fri Sep 4 22:18:37 2026')).toEqual({
        pid: 42,
        startedAt: 'Fri Sep 4 22:18:37 2026',
        tty: null,
        ttyIdentity: null,
      })
    })
  })

  describe('resolveForegroundName', () => {
    it('returns the tty foreground group leader when running a command', () => {
      const rows = table(row(100, 1, 100, 200, 'zsh'), row(200, 100, 200, 100, 'vim'))
      expect(resolveForegroundName(100, rows)).toBe('vim')
    })

    it('falls back to a live group member when the leader already exited', () => {
      const rows = table(
        row(100, 1, 100, 300, 'zsh'),
        // Group 300's leader is gone; only a member script remains.
        row(301, 100, 300, 100, 'watch-script'),
      )
      expect(resolveForegroundName(100, rows)).toBe('watch-script')
    })

    it('returns the shell itself when idle at the prompt', () => {
      // At a prompt the tty foreground group is the shell's own group.
      const rows = table(row(100, 1, 100, 100, 'zsh'))
      expect(resolveForegroundName(100, rows)).toBe('zsh')
    })

    it('falls back to descendants when the foreground group has no live member', () => {
      const rows = table(row(100, 1, 100, 999, 'zsh'), row(200, 100, 200, 100, 'pnpm'))
      expect(resolveForegroundName(100, rows)).toBe('pnpm')
    })

    it('falls back to the nearest descendant when tpgid is unavailable', () => {
      const rows = table(
        row(100, 1, 100, -1, 'zsh'),
        row(200, 100, 200, -1, 'pnpm'),
        row(201, 200, 201, -1, 'node'),
      )
      expect(resolveForegroundName(100, rows)).toBe('pnpm')
    })

    it('falls back to the nearest descendant when the shell row is missing', () => {
      const rows = table(row(200, 100, 200, -1, 'pnpm'))
      expect(resolveForegroundName(100, rows)).toBe('pnpm')
    })
  })

  describe('collectDescendants', () => {
    it('includes the root shell pid for port attribution without naming it as child work', () => {
      const rows = table(row(100, 1, 100, 100, 'zsh'), row(200, 100, 200, 100, 'node'))

      expect(collectDescendants(100, rows)).toEqual({
        names: ['node'],
        pids: new Set([100, 200]),
      })
    })
  })

  it('does not launch delayed tty fallback probes on Windows', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')

    await expect(readProcessTty(42)).resolves.toBeNull()
  })

  it('aborts a timed-out tty snapshot before it can launch the second-stage ps probe', async () => {
    vi.useFakeTimers()
    let probeSignal: AbortSignal | undefined
    let probeTimeout: number | undefined
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: readonly string[],
        options: { readonly signal?: AbortSignal; readonly timeout?: number },
      ) => {
        probeSignal = options.signal
        probeTimeout = options.timeout
        return undefined
      },
    )

    const refresh = refreshTerminalProcessPids(42, [], [], 'ttys001', 'darwin:16:1', false, 10)
    await vi.advanceTimersByTimeAsync(10)

    await expect(refresh).resolves.toMatchObject({ reliable: false })
    expect(probeSignal?.aborted).toBe(true)
    expect(probeTimeout).toBe(10)
    expect(execFileMock).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(4_000)
    expect(execFileMock).toHaveBeenCalledOnce()
  })
})
