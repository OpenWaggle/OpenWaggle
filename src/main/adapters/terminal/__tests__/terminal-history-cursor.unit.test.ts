import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHistoryFiles } from '../terminal-history-files'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('terminal history cursor recovery', () => {
  let logsDir: string

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cursor-journal-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('recovers a cursor journal before or after its log append without repeating output', async () => {
    const key = 'session-journal::action'
    const store = makeTerminalHistoryStore(logsDir)
    store.appendWithCursor(key, 'old ', 4)
    await store.flush()
    const { cursorFile } = makeTerminalHistoryFiles(logsDir).describe(key)
    const pending = JSON.stringify({ kind: 'append', endOffset: 8, previousBytes: 4, text: 'new!' })

    await fs.writeFile(cursorFile, pending)
    await expect(makeTerminalHistoryStore(logsDir).readWithCursor(key)).resolves.toEqual({
      text: 'old new!',
      endOffset: 8,
    })

    await fs.writeFile(cursorFile, pending)
    await expect(makeTerminalHistoryStore(logsDir).readWithCursor(key)).resolves.toEqual({
      text: 'old new!',
      endOffset: 8,
    })
    await expect(fs.readFile(cursorFile, 'utf8')).resolves.toBe('8')
  })

  it('recovers a compacted log and cursor together when its replacement had not landed', async () => {
    const key = 'session-compact-journal::action'
    const store = makeTerminalHistoryStore(logsDir)
    store.appendWithCursor(key, 'old', 3)
    await store.flush()
    const { cursorFile } = makeTerminalHistoryFiles(logsDir).describe(key)
    await fs.writeFile(
      cursorFile,
      JSON.stringify({ kind: 'replace', endOffset: 10_003, text: 'new-retained' }),
    )
    await expect(makeTerminalHistoryStore(logsDir).readWithCursor(key)).resolves.toEqual({
      text: 'new-retained',
      endOffset: 10_003,
    })
  })

  it('keeps a failed scheduled history flush visible to final flush', async () => {
    const occupiedPath = path.join(logsDir, 'occupied')
    await fs.writeFile(occupiedPath, 'not a directory')
    const store = makeTerminalHistoryStore(path.join(occupiedPath, 'logs'))
    vi.useFakeTimers()
    store.append('session-failed::main', 'lost otherwise')
    await vi.advanceTimersByTimeAsync(TERMINAL.HISTORY_FLUSH_MS)
    await expect(store.flush()).rejects.toThrow()
  })
})
