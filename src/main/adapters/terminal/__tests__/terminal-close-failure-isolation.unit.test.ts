import { promises as fs } from 'node:fs'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTerminalHistoryFiles } from '../terminal-history-files'
import {
  OWNER,
  open,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  terminalHistoryLogsDir,
  workDirA,
} from './terminal-service-actions-test-harness'

beforeEach(setupTerminalServiceActionsTest)
afterEach(teardownTerminalServiceActionsTest)

it.each(['terminal', 'owner', 'path'] as const)(
  'does not report another terminal history failure when deleting a %s',
  async (scope) => {
    await open(workDirA)
    await settle()
    const badKey = 'session-unrelated::main'
    const { metadataFile } = makeTerminalHistoryFiles(terminalHistoryLogsDir()).describe(badKey)
    await fs.mkdir(metadataFile)
    service.history.append(badKey, 'retry later')
    await expect(service.history.flush(badKey)).rejects.toThrow()

    try {
      const close = {
        terminal: () => service.close(OWNER, TERMINAL_ID, true),
        owner: () => service.closeAllForOwner(OWNER, true),
        path: () => service.closeAllUnderPath(workDirA, true),
      }[scope]
      await expect(Effect.runPromise(close())).resolves.toBeUndefined()
      expect(service.records.has(TERMINAL_KEY)).toBe(false)
      await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
    } finally {
      await fs.rm(metadataFile, { recursive: true })
      await service.history.flush()
    }
  },
)
