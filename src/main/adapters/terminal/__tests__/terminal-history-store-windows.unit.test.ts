import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('terminal history Windows-style owner keys', () => {
  let logsDir: string

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-history-windows-'))
  })

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('moves and removes a drive-qualified draft owner without parsing it as a path', async () => {
    const store = makeTerminalHistoryStore(logsDir)
    const draftOwner = 'draft:C:\\Users\\Developer\\OpenWaggle'
    const sessionOwner = 'session-from-windows-draft'
    store.append(`${draftOwner}::main`, 'main history')
    store.append(`${draftOwner}::side`, 'side history')

    await store.moveOwner(draftOwner, sessionOwner)

    await expect(store.read(`${draftOwner}::main`)).resolves.toBe('')
    await expect(store.read(`${sessionOwner}::main`)).resolves.toBe('main history')
    await expect(store.read(`${sessionOwner}::side`)).resolves.toBe('side history')

    await store.removeForOwner(sessionOwner)

    await expect(store.read(`${sessionOwner}::main`)).resolves.toBe('')
    await expect(store.read(`${sessionOwner}::side`)).resolves.toBe('')
  })
})
