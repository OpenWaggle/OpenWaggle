import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtySpawnOutcome } from '../terminal-pty-runner'
import {
  addRecord,
  FAKE_PID,
  INPUT,
  makeFakePty,
  makeRuntime,
  setupTerminalRuntimeTest,
  teardownTerminalRuntimeTest,
} from './terminal-runtime-test-harness'

describe('makeTerminalRuntime pending-spawn shutdown', () => {
  beforeEach(setupTerminalRuntimeTest)
  afterEach(teardownTerminalRuntimeTest)

  it('bounds shutdown while an asynchronous spawn remains pending', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, spawn } = makeRuntime(fake)
    spawn.mockImplementation(() => new Promise<PtySpawnOutcome>(() => undefined))
    const record = addRecord(runtime)
    runtime.spawn(record, INPUT.cols, INPUT.rows)

    let settled = false
    const shutdown = runtime.killLive(record).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(249)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(shutdown).resolves.toBe(false)
  })
})
