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
    vi.restoreAllMocks()
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

  it('retries a transient scheduled failure and clears it after the cursor batch commits', async () => {
    const occupiedPath = path.join(logsDir, 'occupied')
    await fs.writeFile(occupiedPath, 'not a directory')
    const store = makeTerminalHistoryStore(path.join(occupiedPath, 'logs'))
    vi.useFakeTimers()
    store.appendWithCursor('session-failed::action', 'retained', 8)
    await vi.advanceTimersByTimeAsync(TERMINAL.HISTORY_FLUSH_MS)
    await expect(store.flush('session-failed::action')).rejects.toThrow()
    await fs.rm(occupiedPath)
    await fs.mkdir(occupiedPath)
    await expect(store.flush('session-failed::action')).resolves.toBeUndefined()
    await expect(store.readWithCursor('session-failed::action')).resolves.toEqual({
      text: 'retained',
      endOffset: 8,
    })
  })

  it('retries a batch whose journal landed before its log append failed', async () => {
    const key = 'session-journal-retry::action'
    const store = makeTerminalHistoryStore(logsDir)
    store.appendWithCursor(key, 'old', 3)
    await store.flush(key)
    vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('Transient append failure'))
    store.appendWithCursor(key, 'new', 6)
    await expect(store.flush(key)).rejects.toThrow()

    await expect(store.flush(key)).resolves.toBeUndefined()
    await expect(store.readWithCursor(key)).resolves.toEqual({ text: 'oldnew', endOffset: 6 })
  })

  it('retries a failed cursor batch before a newer flush already waiting in the queue', async () => {
    const key = 'session-queued-retry::action'
    const store = makeTerminalHistoryStore(logsDir)
    let signalAppendStarted = () => {}
    const appendStarted = new Promise<void>((resolve) => {
      signalAppendStarted = resolve
    })
    let releaseAppend = () => {}
    const appendBlocked = new Promise<void>((resolve) => {
      releaseAppend = resolve
    })
    vi.spyOn(fs, 'appendFile').mockImplementationOnce(async () => {
      signalAppendStarted()
      await appendBlocked
      throw new Error('Transient append failure')
    })

    store.appendWithCursor(key, 'first', 5)
    const firstFlush = store.flush(key).then(
      () => 'committed',
      () => 'failed',
    )
    await appendStarted
    store.appendWithCursor(key, 'second', 11)
    const secondFlush = store.flush(key)
    releaseAppend()

    await expect(firstFlush).resolves.toBe('failed')
    await expect(secondFlush).resolves.toBeUndefined()
    await expect(store.readWithCursor(key)).resolves.toEqual({ text: 'firstsecond', endOffset: 11 })
  })

  it('does not let an unrelated terminal failure block a healthy action flush', async () => {
    const badKey = 'session-failed::main'
    const actionKey = 'session-healthy::action'
    const { metadataFile } = makeTerminalHistoryFiles(logsDir).describe(badKey)
    await fs.mkdir(metadataFile)
    const store = makeTerminalHistoryStore(logsDir)
    store.append(badKey, 'unwritten')
    store.appendWithCursor(actionKey, 'healthy', 7)
    await expect(store.flush(actionKey)).resolves.toBeUndefined()
    await expect(store.flush()).rejects.toThrow()
    await expect(store.readWithCursor(actionKey)).resolves.toEqual({
      text: 'healthy',
      endOffset: 7,
    })
  })
})
