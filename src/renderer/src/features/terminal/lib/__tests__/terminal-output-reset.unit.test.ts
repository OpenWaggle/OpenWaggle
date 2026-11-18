import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { resetTerminalOutput, writeTerminalOutput } from '../write-terminal-output'

describe('terminal output reset ordering with real xterm', () => {
  it.each(['', '\x1b[', '\x1b]0;unfinished title', '\x1bPunfinished data'])(
    'clears queued old output and an unfinished escape sequence %j before the replacement',
    async (tail) => {
      const terminal = new Terminal({ cols: 80, rows: 5, scrollback: 0 })
      try {
        writeTerminalOutput(terminal, `${'OLD_GENERATION\r\n'.repeat(10_000)}${tail}`)
        resetTerminalOutput(terminal)
        const parsed = Promise.withResolvers<void>()
        writeTerminalOutput(terminal, 'NEW_GENERATION', parsed.resolve)
        await parsed.promise

        expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('NEW_GENERATION')
        expect(terminal.buffer.active.cursorY).toBe(0)
        for (let row = 1; row < terminal.rows; row += 1) {
          expect(terminal.buffer.active.getLine(row)?.translateToString(true)).toBe('')
        }
      } finally {
        terminal.dispose()
      }
    },
  )
})
