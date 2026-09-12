import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('makeTerminalHistoryStore', () => {
  let logsDir: string

  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('base64url')
  const logFile = (key: string) => {
    const separator = key.lastIndexOf('::')
    const ownerKey = separator === -1 ? key : key.slice(0, separator)
    return path.join(logsDir, `${digest(ownerKey)}.${digest(key)}.log`)
  }

  const directoryEntries = async (extension = '.log') => {
    try {
      return (await fs.readdir(logsDir)).filter((entry) => entry.endsWith(extension))
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

    await store.removeForOwner('session-a')

    await vi.waitFor(async () => {
      const entries = await directoryEntries()
      expect(entries).toEqual([path.basename(logFile('session-b::main'))])
    })
    await expect(store.read('session-a::main')).resolves.toBe('')
    await expect(store.read('session-a::side')).resolves.toBe('')
    await expect(store.read('session-b::main')).resolves.toBe('owner b terminal 1')
  })

  it('uses fixed-length digest filenames for long Unicode draft owners', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const ownerKey = `draft:/tmp/${'資料🙂'.repeat(180)}`
    const key = `${ownerKey}::main`
    store.append(key, 'history')
    await store.flush()

    const entries = await fs.readdir(logsDir)
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.length <= 92)).toBe(true)
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.log$/),
        expect.stringMatching(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.meta$/),
      ]),
    )
    await expect(store.read(key)).resolves.toBe('history')
  })

  it('removes a long Unicode owner without decoding its filename', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const ownerKey = `draft:/tmp/${'資料🙂'.repeat(180)}`
    const otherOwner = `${ownerKey}-other`
    store.append(`${ownerKey}::main`, 'remove me')
    store.append(`${otherOwner}::main`, 'keep me')
    await store.flush()

    await store.removeForOwner(ownerKey)

    await expect(store.read(`${ownerKey}::main`)).resolves.toBe('')
    await expect(store.read(`${otherOwner}::main`)).resolves.toBe('keep me')
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
    await store.remove(key)
  })

  it('caps a persisted no-newline Unicode flood by UTF-8 bytes', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-byte-cap::main'
    const flood = `discard${'🙂'.repeat(Math.ceil(TERMINAL.MAX_SCROLLBACK_BYTES / 4) + 10)}`
    store.append(key, flood)
    await store.flush()

    const stat = await fs.stat(logFile(key))
    const replay = await store.read(key)
    expect(stat.size).toBeLessThanOrEqual(TERMINAL.MAX_SCROLLBACK_BYTES)
    expect(Buffer.byteLength(replay, 'utf8')).toBeLessThanOrEqual(TERMINAL.MAX_SCROLLBACK_BYTES)
    expect(replay.endsWith('🙂'.repeat(10))).toBe(true)
    expect(replay.includes('\uFFFD')).toBe(false)
  })

  it('creates private history files and a private directory where modes are supported', async () => {
    if (process.platform === 'win32') return
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-private::main'
    store.append(key, 'private')
    await store.flush()

    const directoryMode = (await fs.stat(logsDir)).mode & 0o777
    const fileMode = (await fs.stat(logFile(key))).mode & 0o777
    const metadataFile = logFile(key).replace(/\.log$/, '.meta')
    const metadataMode = (await fs.stat(metadataFile)).mode & 0o777
    expect(directoryMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
    expect(metadataMode).toBe(0o600)
  })

  it('neutralizes persisted TUI modes only when history is cold-replayed', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-replay::main'
    store.append(key, 'before\x1b[31mred\x1b[0m\x1b[?1049hinside\x1b[?2004hafter')
    await store.flush()

    await expect(store.read(key)).resolves.toBe('before\x1b[31mred\x1b[0minsideafter')
    await expect(fs.readFile(logFile(key), 'utf8')).resolves.toContain('\x1b[?1049h')
  })

  it('serializes truncate before later appends', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-race::truncate'
    store.append(key, 'old')
    await store.flush()

    store.append(key, 'drop')
    const truncating = store.truncate(key)
    store.append(key, 'fresh')
    await Promise.all([truncating, store.flush()])

    await expect(store.read(key)).resolves.toBe('fresh')
  })

  it('serializes remove before later appends', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-race::remove'
    store.append(key, 'old')
    await store.flush()

    const removing = store.remove(key)
    store.append(key, 'fresh')
    await Promise.all([removing, store.flush()])

    await expect(store.read(key)).resolves.toBe('fresh')
  })

  it('serializes owner removal before later appends', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const ownerKey = 'session-owner-race'
    const key = `${ownerKey}::main`
    store.append(key, 'old')
    await store.flush()

    const removing = store.removeForOwner(ownerKey)
    store.append(key, 'fresh')
    await Promise.all([removing, store.flush()])

    await expect(store.read(key)).resolves.toBe('fresh')
  })

  it('moves one key behind pending appends and preserves later destination appends', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const fromKey = 'draft:/repo::main'
    const toKey = 'session-moved::main'
    store.append(fromKey, 'old ')

    const moving = store.move(fromKey, toKey)
    store.append(toKey, 'new')
    await Promise.all([moving, store.flush()])

    await expect(store.read(fromKey)).resolves.toBe('')
    await expect(store.read(toKey)).resolves.toBe('old new')
  })

  it('rejects a move collision without changing either history', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const fromKey = 'draft:/repo::main'
    const toKey = 'session-existing::main'
    store.append(fromKey, 'source')
    store.append(toKey, 'destination')
    await store.flush()

    await expect(store.move(fromKey, toKey)).rejects.toThrow(/destination/i)
    await expect(store.read(fromKey)).resolves.toBe('source')
    await expect(store.read(toKey)).resolves.toBe('destination')
  })

  it('moves every owner history, including terminals absent from runtime memory', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const fromOwner = `draft:/repo/${'長い🙂'.repeat(80)}`
    const toOwner = 'session-created'
    store.append(`${fromOwner}::main`, 'main')
    store.append(`${fromOwner}::hidden-pane`, 'hidden')
    store.append('unrelated::main', 'other')

    await store.moveOwner(fromOwner, toOwner)

    await expect(store.read(`${fromOwner}::main`)).resolves.toBe('')
    await expect(store.read(`${fromOwner}::hidden-pane`)).resolves.toBe('')
    await expect(store.read(`${toOwner}::main`)).resolves.toBe('main')
    await expect(store.read(`${toOwner}::hidden-pane`)).resolves.toBe('hidden')
    await expect(store.read('unrelated::main')).resolves.toBe('other')
  })

  it('preflights every owner destination before moving any source file', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const fromOwner = 'draft:/repo'
    const toOwner = 'session-existing'
    store.append(`${fromOwner}::main`, 'source-main')
    store.append(`${fromOwner}::side`, 'source-side')
    store.append(`${toOwner}::side`, 'destination-side')
    await store.flush()

    await expect(store.moveOwner(fromOwner, toOwner)).rejects.toThrow(/destination/i)

    await expect(store.read(`${fromOwner}::main`)).resolves.toBe('source-main')
    await expect(store.read(`${fromOwner}::side`)).resolves.toBe('source-side')
    await expect(store.read(`${toOwner}::main`)).resolves.toBe('')
    await expect(store.read(`${toOwner}::side`)).resolves.toBe('destination-side')
  })
})
