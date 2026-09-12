import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  feed,
  OWNER,
  open,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

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

    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    await expectReleasedButPersisted()
  })

  it('releases cache state when a worktree stops without deleting disk history', async () => {
    await persistAndCacheHistory()

    await Effect.runPromise(service.closeAllUnderPath(workDirA, false))

    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    await expectReleasedButPersisted()
  })
})
