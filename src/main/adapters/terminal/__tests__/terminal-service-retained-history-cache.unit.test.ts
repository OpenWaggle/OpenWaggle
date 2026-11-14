import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  feed,
  open,
  OWNER,
  service,
  settle,
  setupTerminalServiceActionsTest,
  teardownTerminalServiceActionsTest,
  TERMINAL_KEY,
  workDirA,
} from './terminal-service-actions-test-harness'
import { terminalKeys } from './terminal-service-observations'

async function persistAndCacheHistory() {
  await open(workDirA)
  await settle()
  feed(0, 'retained history')
  await service.history.flush()
  await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('retained history')
  expect(service.history.cacheSnapshotForTests().states).toHaveLength(1)
}

async function expectReleasedButPersisted() {
  expect(service.history.cacheSnapshotForTests()).toEqual({
    states: [],
    workingDirectories: [],
  })
  await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('retained history')
}

describe('retained terminal history cache cleanup', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('releases cache state when an owner is archived without deleting disk history', async () => {
    await persistAndCacheHistory()

    await Effect.runPromise(service.closeAllForOwner(OWNER, false))

    expect(await terminalKeys()).not.toContain(TERMINAL_KEY)
    await expectReleasedButPersisted()
  })

  it('releases cache state when a worktree stops without deleting disk history', async () => {
    await persistAndCacheHistory()

    await Effect.runPromise(service.closeAllUnderPath(workDirA, false))

    expect(await terminalKeys()).not.toContain(TERMINAL_KEY)
    await expectReleasedButPersisted()
  })
})
