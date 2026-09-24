import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTerminalHistoryFiles } from '../terminal-history-files'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('terminal history move failure isolation', () => {
  let logsDir: string

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-history-move-failures-'))
  })

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('moves a healthy owner despite another owner having a failed history write', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const badKey = 'session-broken::main'
    const fromKey = 'draft:/healthy::main'
    const toKey = 'session-healthy::main'
    const { metadataFile } = makeTerminalHistoryFiles(logsDir).describe(badKey)
    await fs.mkdir(metadataFile)
    store.append(badKey, 'retry later')
    store.append(fromKey, 'move now')

    await expect(store.moveOwner('draft:/healthy', 'session-healthy')).resolves.toBeUndefined()
    await expect(store.read(toKey)).resolves.toBe('move now')
    await expect(store.read(fromKey)).resolves.toBe('')
    await expect(store.flush()).rejects.toThrow()

    await fs.rm(metadataFile, { recursive: true })
    await expect(store.flush()).resolves.toBeUndefined()
    await expect(store.read(badKey)).resolves.toBe('retry later')
  })

  it('does not move an owner whose own history failed to persist', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const fromKey = 'draft:/broken::main'
    const { metadataFile } = makeTerminalHistoryFiles(logsDir).describe(fromKey)
    await fs.mkdir(metadataFile)
    store.append(fromKey, 'retain at source')

    await expect(store.moveOwner('draft:/broken', 'session-created')).rejects.toThrow()
    await fs.rm(metadataFile, { recursive: true })
    await expect(store.flush()).resolves.toBeUndefined()
    await expect(store.read(fromKey)).resolves.toBe('retain at source')
    await expect(store.read('session-created::main')).resolves.toBe('')
  })
})
