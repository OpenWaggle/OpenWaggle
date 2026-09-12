import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRecord,
  FAKE_PID,
  INPUT,
  makeFakePty,
  makeRuntime,
  setupTerminalRuntimeTest,
  successfulOutcome,
  teardownTerminalRuntimeTest,
} from './terminal-runtime-test-harness'

describe('terminal spawn activity labels', () => {
  beforeEach(setupTerminalRuntimeTest)
  afterEach(teardownTerminalRuntimeTest)

  it('keeps the default tab label while only the root shell is running', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    expect(emitted).toContainEqual({
      ownerKey: INPUT.ownerKey,
      terminalId: INPUT.terminalId,
      event: { type: 'activity', processName: null },
    })
    expect(
      emitted.some(
        (payload) => payload.event.type === 'activity' && payload.event.processName === 'zsh',
      ),
    ).toBe(false)
  })

  it('attaches the controlling tty captured by the node-pty spawn boundary', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, spawn } = makeRuntime(fake)
    spawn.mockResolvedValue(successfulOutcome(fake, 'ttys123'))
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.live?.tty).toBe('ttys123')
  })
})
