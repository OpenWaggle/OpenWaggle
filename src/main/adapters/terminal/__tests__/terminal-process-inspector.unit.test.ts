import { describe, expect, it } from 'vitest'
import {
  type ProcessRow,
  parsePosixRow,
  resolveForegroundName,
} from '../terminal-process-inspector'

function row(pid: number, ppid: number, pgid: number, tpgid: number, name: string): ProcessRow {
  return { pid, ppid, pgid, tpgid, name }
}

function table(...rows: readonly ProcessRow[]) {
  return new Map(rows.map((entry) => [entry.pid, entry]))
}

describe('terminal process inspector', () => {
  describe('parsePosixRow', () => {
    it('parses pid, ppid, pgid, tpgid, and a command name with spaces', () => {
      // macOS comm values like "Google Chrome Helper" contain spaces, so the
      // parser joins every column after tpgid into the name.
      expect(parsePosixRow('  42   7  42  99 /usr/local/bin/node server.js')).toEqual({
        pid: 42,
        ppid: 7,
        pgid: 42,
        tpgid: 99,
        name: 'node server.js',
      })
    })

    it('rejects header fragments and short rows', () => {
      expect(parsePosixRow('')).toBeNull()
      expect(parsePosixRow('ps header junk')).toBeNull()
      expect(parsePosixRow('abc def ghi jkl name')).toBeNull()
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
})
