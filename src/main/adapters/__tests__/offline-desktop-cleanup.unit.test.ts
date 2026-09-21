import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node-pty', () => {
  throw new Error('Offline cleanup must never load node-pty')
})
vi.mock('electron', () => {
  throw new Error('Offline cleanup must never load Electron')
})

import { makeOfflineDesktopCleanupExecutor } from '../offline-desktop-cleanup'
import { makeTerminalHistoryStore } from '../terminal/terminal-history-store'

describe('offline desktop cleanup under broker ownership proof', () => {
  let root = ''
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-offline-desktop-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function seed() {
    const logsDir = path.join(root, 'terminal-logs')
    const history = makeTerminalHistoryStore(logsDir)
    const worktree = path.join(root, 'worktree')
    await history.registerWorkingDirectory('worker::main', worktree)
    await history.registerWorkingDirectory('worker::second', path.join(worktree, 'nested'))
    await history.registerWorkingDirectory('worker-other::main', path.join(root, 'worktree-other'))
    history.append('worker::main', 'main history')
    history.append('worker::second', 'second history')
    history.append('worker-other::main', 'unrelated history')
    await history.flush()
    return { logsDir, worktree }
  }

  it('does not create a native runtime or history directory when there are no live processes to stop', async () => {
    const logsDir = path.join(root, 'missing-history')
    const execute = makeOfflineDesktopCleanupExecutor(logsDir)
    for (const command of [
      {
        service: 'terminal',
        operation: 'closeAllForOwner',
        input: { ownerKey: 'worker', deleteHistory: false },
      },
      {
        service: 'terminal',
        operation: 'closeAllUnderPath',
        input: { directoryPath: path.join(root, 'worktree'), deleteHistory: false },
      },
      { service: 'browser', operation: 'deleteOwner', ownerKey: 'worker' },
    ] as const) {
      await expect(Effect.runPromise(execute(command))).resolves.toEqual({
        service: command.service,
        operation: command.operation,
        value: null,
      })
    }
    await expect(fs.stat(logsDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains cold scrollback on stop and removes only the exact deleted owner histories', async () => {
    const { logsDir } = await seed()
    const execute = makeOfflineDesktopCleanupExecutor(logsDir)
    await Effect.runPromise(
      execute({
        service: 'terminal',
        operation: 'closeAllForOwner',
        input: { ownerKey: 'worker', deleteHistory: false },
      }),
    )
    const reader = makeTerminalHistoryStore(logsDir)
    await expect(reader.read('worker::main')).resolves.toBe('main history')
    await Effect.runPromise(
      execute({
        service: 'terminal',
        operation: 'closeAllForOwner',
        input: { ownerKey: 'worker', deleteHistory: true },
      }),
    )
    const after = makeTerminalHistoryStore(logsDir)
    await expect(after.read('worker::main')).resolves.toBe('')
    await expect(after.read('worker::second')).resolves.toBe('')
    await expect(after.read('worker-other::main')).resolves.toBe('unrelated history')
  })

  it('removes cold histories beneath a working path without matching a sibling prefix', async () => {
    const { logsDir, worktree } = await seed()
    await Effect.runPromise(
      makeOfflineDesktopCleanupExecutor(logsDir)({
        service: 'terminal',
        operation: 'closeAllUnderPath',
        input: { directoryPath: worktree, deleteHistory: true },
      }),
    )
    const after = makeTerminalHistoryStore(logsDir)
    await expect(after.read('worker::main')).resolves.toBe('')
    await expect(after.read('worker::second')).resolves.toBe('')
    await expect(after.read('worker-other::main')).resolves.toBe('unrelated history')
  })

  it('surfaces a failed history deletion rather than acknowledging cleanup', async () => {
    const notADirectory = path.join(root, 'file-instead-of-history-directory')
    await fs.writeFile(notADirectory, 'keep')
    await expect(
      Effect.runPromise(
        makeOfflineDesktopCleanupExecutor(notADirectory)({
          service: 'terminal',
          operation: 'closeAllForOwner',
          input: { ownerKey: 'worker', deleteHistory: true },
        }),
      ),
    ).rejects.toThrow()
    await expect(fs.readFile(notADirectory, 'utf8')).resolves.toBe('keep')
  })

  const unsupportedCommands: readonly DesktopServiceCommand[] = [
    { service: 'terminal', operation: 'getActivitySnapshot', input: {} },
    { service: 'terminal', operation: 'closeAll', input: {} },
    {
      service: 'terminal',
      operation: 'write',
      input: { ownerKey: 'worker', terminalId: 'main', data: 'unsafe' },
    },
  ]
  it.each(unsupportedCommands)(
    'rejects unsupported offline operation $operation',
    async (command: DesktopServiceCommand) => {
      await expect(
        Effect.runPromise(makeOfflineDesktopCleanupExecutor(path.join(root, 'logs'))(command)),
      ).rejects.toThrow()
      await expect(fs.readdir(root)).resolves.toEqual([])
    },
  )

  it('rejects relative cleanup targets and empty owner scopes before touching history', async () => {
    const execute = makeOfflineDesktopCleanupExecutor(path.join(root, 'logs'))
    await expect(
      Effect.runPromise(
        execute({
          service: 'terminal',
          operation: 'closeAllUnderPath',
          input: { directoryPath: '.', deleteHistory: true },
        }),
      ),
    ).rejects.toThrow('must be absolute')
    await expect(
      Effect.runPromise(
        execute({
          service: 'terminal',
          operation: 'closeAllForOwner',
          input: { ownerKey: '', deleteHistory: true },
        }),
      ),
    ).rejects.toThrow('owner is required')
    await expect(fs.readdir(root)).resolves.toEqual([])
  })
})
