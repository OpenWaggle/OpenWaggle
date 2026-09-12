import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'

describe('terminal history working-path cleanup', () => {
  let logsDir: string

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-history-path-'))
  })

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('removes cold histories by persisted working path after a service restart', async () => {
    const insideKey = 'session-inside::main'
    const nestedKey = 'session-nested::main'
    const outsideKey = 'session-outside::main'
    const worktreePath = path.join(logsDir, 'worktree')
    const first = makeTerminalHistoryStore(logsDir)
    await Promise.all([
      first.registerWorkingDirectory(insideKey, worktreePath),
      first.registerWorkingDirectory(nestedKey, path.join(worktreePath, 'packages', 'app')),
      first.registerWorkingDirectory(outsideKey, path.join(logsDir, 'other-worktree')),
    ])
    first.append(insideKey, 'inside')
    first.append(nestedKey, 'nested')
    first.append(outsideKey, 'outside')
    await first.flush()

    const restarted = makeTerminalHistoryStore(logsDir)
    await restarted.removeForPath(worktreePath)

    await expect(restarted.read(insideKey)).resolves.toBe('')
    await expect(restarted.read(nestedKey)).resolves.toBe('')
    await expect(restarted.read(outsideKey)).resolves.toBe('outside')
  })

  it('moves persisted working-path metadata with a draft owner', async () => {
    const worktreePath = path.join(logsDir, 'moved-worktree')
    const fromKey = 'draft:/repo::main'
    const toKey = 'session-created::main'
    const store = makeTerminalHistoryStore(logsDir)
    await store.registerWorkingDirectory(fromKey, worktreePath)
    store.append(fromKey, 'moved history')
    await store.moveOwner('draft:/repo', 'session-created')

    const restarted = makeTerminalHistoryStore(logsDir)
    await restarted.removeForPath(worktreePath)

    await expect(restarted.read(fromKey)).resolves.toBe('')
    await expect(restarted.read(toKey)).resolves.toBe('')
  })
})
