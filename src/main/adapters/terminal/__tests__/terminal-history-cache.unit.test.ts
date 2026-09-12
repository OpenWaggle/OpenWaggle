import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('terminal history cache', () => {
  let logsDir: string

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-history-cache-'))
  })

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('retains counts only and releases them without deleting replay', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const key = 'session-release::main'
    await store.registerWorkingDirectory(key, '/worktrees/session-release')
    store.append(key, 'persisted\nreplay')
    await store.flush()
    await expect(store.read(key)).resolves.toBe('persisted\nreplay')

    expect(store.cacheSnapshotForTests()).toEqual({
      states: [{ key, bytes: 16, lines: 1 }],
      workingDirectories: [{ key, cwd: '/worktrees/session-release' }],
    })

    await store.release(key)

    expect(store.cacheSnapshotForTests()).toEqual({ states: [], workingDirectories: [] })
    await expect(store.read(key)).resolves.toBe('persisted\nreplay')
  })
})
