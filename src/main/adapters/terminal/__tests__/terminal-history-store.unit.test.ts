import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('makeTerminalHistoryStore', () => {
  let logsDir: string

  const logFile = (key: string) =>
    path.join(logsDir, `${Buffer.from(key, 'utf8').toString('base64url')}.log`)

  const directoryEntries = async () => {
    try {
      return await fs.readdir(logsDir)
    } catch {
      return []
    }
  }

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-history-'))
  })

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('reads an empty string for terminals without history', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    await expect(store.read('session-1::main')).resolves.toBe('')
  })

  it('appends through the coalescing window without an explicit flush', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    vi.useFakeTimers()
    try {
      store.append('session-1::main', 'hello\n')

      await vi.advanceTimersByTimeAsync(TERMINAL.HISTORY_FLUSH_MS)
    } finally {
      vi.useRealTimers()
    }
    await vi.waitFor(async () => {
      await expect(store.read('session-1::main')).resolves.toBe('hello\n')
    })
  })

  it('coalesces appends into one persisted chunk on flush', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    store.append('session-1::main', 'first ')
    store.append('session-1::main', 'second')
    store.append('session-2::main', 'other terminal')

    await store.flush()

    await expect(store.read('session-1::main')).resolves.toBe('first second')
    await expect(store.read('session-2::main')).resolves.toBe('other terminal')
  })

  it('flushes cleanly when nothing is pending', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('drops pending appends and empties the file on truncate', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    store.append('session-1::main', 'old scrollback')
    await store.flush()

    store.append('session-1::main', 'buffered but about to be dropped')
    store.truncate('session-1::main')

    await vi.waitFor(async () => {
      await expect(store.read('session-1::main')).resolves.toBe('')
    })
  })

  it('accepts appends again after truncate', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    store.append('session-1::main', 'old scrollback')
    store.truncate('session-1::main')
    await vi.waitFor(async () => {
      await expect(store.read('session-1::main')).resolves.toBe('')
    })

    store.append('session-1::main', 'fresh output')
    await store.flush()
    await expect(store.read('session-1::main')).resolves.toBe('fresh output')
  })

  it('deletes one terminal file on remove', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    store.append('session-1::main', 'to be deleted')
    await store.flush()

    store.remove('session-1::main')

    await vi.waitFor(async () => {
      await expect(fs.stat(logFile('session-1::main'))).rejects.toThrow()
    })
    await expect(store.read('session-1::main')).resolves.toBe('')
  })

  it('removes only the requested owner files on removeForOwner', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    store.append('session-a::main', 'owner a terminal 1')
    store.append('session-a::side', 'owner a terminal 2')
    store.append('session-b::main', 'owner b terminal 1')
    await store.flush()
    expect(await directoryEntries()).toHaveLength(3)

    store.removeForOwner('session-a')

    await vi.waitFor(async () => {
      const entries = await directoryEntries()
      expect(entries).toEqual([path.basename(logFile('session-b::main'))])
    })
    await expect(store.read('session-a::main')).resolves.toBe('')
    await expect(store.read('session-a::side')).resolves.toBe('')
    await expect(store.read('session-b::main')).resolves.toBe('owner b terminal 1')
  })

  it('compacts the file to the scrollback cap after bursty output', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-cap::main'
    const lines = TERMINAL.MAX_SCROLLBACK_LINES * 3
    let flood = ''
    for (let index = 0; index < lines; index += 1) flood += `line-${index}\n`
    store.append(key, flood)
    await store.flush()
    await vi.waitFor(async () => {
      const content = await store.read(key)
      expect(content.split('\n').length).toBeLessThanOrEqual(TERMINAL.MAX_SCROLLBACK_LINES + 1)
      expect(content).toContain(`line-${lines - 1}`)
      expect(content).not.toContain('line-0\n')
    })
    store.remove(key)
  })
})
