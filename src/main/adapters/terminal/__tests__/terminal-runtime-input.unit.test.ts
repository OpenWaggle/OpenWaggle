import { TERMINAL } from '@shared/constants/resource-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRecord,
  BEL,
  ESC,
  FAKE_PID,
  INPUT,
  makeFakePty,
  makeRuntime,
  setupTerminalRuntimeTest,
  teardownTerminalRuntimeTest,
} from './terminal-runtime-test-harness'

describe('makeTerminalRuntime input and Project Actions', () => {
  beforeEach(setupTerminalRuntimeTest)
  afterEach(teardownTerminalRuntimeTest)

  it('queues early UTF-8 input until an exact prompt-end marker, preserving order once', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'ordered-input')
    expect(runtime.writeInput(record, 'α')).toEqual({ status: 'queued', acceptedBytes: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.writeInput(record, '🙂z')).toEqual({ status: 'queued', acceptedBytes: 5 })

    fake.dataListeners[0]?.('early banner and startup output')
    expect(fake.write).not.toHaveBeenCalled()
    expect(record.readinessPhase).toBe('awaiting-prompt')

    const marker = `${ESC}]633;B;ordered-input${BEL}`
    fake.dataListeners[0]?.(marker.slice(0, 5))
    expect(fake.write).not.toHaveBeenCalled()
    fake.dataListeners[0]?.(marker.slice(5))

    expect(record.readinessPhase).toBe('ready')
    expect(fake.write.mock.calls.flat()).toEqual(['α', '🙂z'])
    expect(record.pendingInput).toEqual([])
    expect(record.pendingInputBytes).toBe(0)

    fake.dataListeners[0]?.(marker)
    expect(fake.write).toHaveBeenCalledTimes(2)
  })

  it('requires an expected nonce before releasing queued input', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'fresh')
    await vi.advanceTimersByTimeAsync(0)
    runtime.writeInput(record, 'queued')
    fake.dataListeners[0]?.(`${ESC}]633;B;stale${BEL}`)
    fake.dataListeners[0]?.(`${ESC}]633;B${BEL}`)
    expect(fake.write).not.toHaveBeenCalled()

    fake.dataListeners[0]?.(`${ESC}]633;B;fresh${BEL}`)
    expect(fake.write).toHaveBeenCalledExactlyOnceWith('queued')
  })

  it('arbitrates one atomic Project Action until a later prompt', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    const intent = { kind: 'project-action', executionId: 'action-1' } as const

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'action-barrier')
    await vi.advanceTimersByTimeAsync(0)
    const marker = `${ESC}]633;B;action-barrier${BEL}`
    fake.dataListeners[0]?.(marker)

    expect(runtime.writeInput(record, 'pnpm test\r', intent)).toEqual({
      status: 'written',
      acceptedBytes: 10,
    })
    expect(fake.write).toHaveBeenCalledExactlyOnceWith('pnpm test\r')
    expect(record.projectAction).toMatchObject({
      executionId: 'action-1',
      deliveredAfterPromptEpoch: 1,
      sawRunning: false,
    })
    expect(
      runtime.writeInput(record, 'pnpm lint\r', {
        kind: 'project-action',
        executionId: 'action-2',
      }),
    ).toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'project-action-pending',
    })

    fake.dataListeners[0]?.(`done${marker}`)
    expect(record.promptEpoch).toBe(2)
    expect(record.projectAction).toBeNull()
  })

  it('does not mistake multiple startup prompt markers for action completion', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'batched-prompts')
    runtime.writeInput(record, 'pnpm test\r', {
      kind: 'project-action',
      executionId: 'action-batched',
    })
    await vi.advanceTimersByTimeAsync(0)
    const marker = `${ESC}]633;B;batched-prompts${BEL}`
    fake.dataListeners[0]?.(`${marker}${marker}`)

    expect(fake.write).toHaveBeenCalledExactlyOnceWith('pnpm test\r')
    expect(record.promptEpoch).toBe(2)
    expect(record.projectAction?.deliveredAfterPromptEpoch).toBe(2)

    fake.dataListeners[0]?.(marker)
    expect(record.projectAction).toBeNull()
  })

  it('accepts the largest Unicode action atomically but keeps ordinary writes at 16 KiB', () => {
    const { runtime } = makeRuntime(makeFakePty(FAKE_PID))
    const record = addRecord(runtime)
    const command = `${'🦭'.repeat(8_192)}\r`

    expect(Buffer.byteLength(command, 'utf8')).toBe(TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES)
    expect(runtime.writeInput(record, command)).toMatchObject({
      status: 'rejected',
      reason: 'input-too-large',
    })
    expect(
      runtime.writeInput(record, command, {
        kind: 'project-action',
        executionId: 'max-unicode',
      }),
    ).toEqual({
      status: 'queued',
      acceptedBytes: TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES,
    })
    expect(record.pendingInput).toHaveLength(1)
  })

  it('clears a delivered action after a reliable running-to-idle observation', () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    record.live = {
      pty: fake.pty,
      pid: fake.pty.pid,
      pauseOutput: fake.pauseOutput,
      resumeOutput: fake.resumeOutput,
      tty: null,
      ttyIdentity: null,
      processIdentity: null,
      processMetadata: Promise.resolve(null),
      exit: fake.exit,
      processTreeExit: fake.processTreeExit,
      resourceDrain: fake.resourceDrain,
      outputPaused: false,
    }
    record.readinessPhase = 'ready'
    record.readinessGeneration = record.spawnGeneration
    runtime.writeInput(record, 'build\r', {
      kind: 'project-action',
      executionId: 'inspected-action',
    })

    record.activity = {
      processName: 'pnpm',
      processNames: ['pnpm'],
      ports: [],
      processPids: [fake.pty.pid],
      processIdentities: [],
      tty: null,
      processReliable: true,
      reliable: true,
    }
    runtime.observeProjectActionActivity(record)
    expect(record.projectAction?.sawRunning).toBe(true)

    record.activity = { ...record.activity, processName: null, processNames: [] }
    runtime.observeProjectActionActivity(record)
    expect(record.projectAction).toBeNull()
  })

  it('drops an undelivered action when the shell exits naturally', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'natural-exit')
    runtime.writeInput(record, 'setup\r', {
      kind: 'project-action',
      executionId: 'natural-exit-action',
    })
    await vi.advanceTimersByTimeAsync(0)
    fake.emitExit(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.projectAction).toBeNull()
    expect(record.pendingInput).toEqual([])
    expect(record.pendingInputBytes).toBe(0)
  })

  it('retains an undelivered action across restart preparation but clears a delivered one', () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    const intent = { kind: 'project-action', executionId: 'restart-action' } as const

    runtime.writeInput(record, 'queued\r', intent)
    runtime.prepareProjectActionForRestart(record)
    expect(record.projectAction?.executionId).toBe('restart-action')
    expect(record.pendingInput).toHaveLength(1)

    record.live = {
      pty: fake.pty,
      pid: fake.pty.pid,
      pauseOutput: fake.pauseOutput,
      resumeOutput: fake.resumeOutput,
      tty: null,
      ttyIdentity: null,
      processIdentity: null,
      processMetadata: Promise.resolve(null),
      exit: fake.exit,
      processTreeExit: fake.processTreeExit,
      resourceDrain: fake.resourceDrain,
      outputPaused: false,
    }
    record.readinessPhase = 'awaiting-prompt'
    record.readinessGeneration = record.spawnGeneration
    // Drain the already accepted item, then prepare the next shell.
    runtime.forceReleaseInput(record)
    runtime.prepareProjectActionForRestart(record)
    expect(record.projectAction).toBeNull()
    expect(record.pendingInput).toEqual([])
  })

  it('rejects queue overflow explicitly without partially accepting the write', () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    const chunk = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES)

    while (record.pendingInputBytes < TERMINAL.MAX_PENDING_INPUT_BYTES) {
      expect(runtime.writeInput(record, chunk).status).toBe('queued')
    }
    const before = [...record.pendingInput]

    expect(runtime.writeInput(record, 'overflow')).toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'queue-full',
    })
    expect(record.pendingInput).toEqual(before)
    expect(record.pendingInputBytes).toBe(TERMINAL.MAX_PENDING_INPUT_BYTES)
  })

  it('rejects input once close has begun instead of acknowledging data that will be discarded', () => {
    const { runtime } = makeRuntime(makeFakePty(FAKE_PID))
    const record = addRecord(runtime)
    record.closed = true

    expect(runtime.writeInput(record, 'too late')).toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'terminal-not-open',
    })
    expect(record.pendingInput).toEqual([])
  })

  it('never writes or releases input through an exited PTY retained for cleanup', () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime } = makeRuntime(fake)
    const record = addRecord(runtime)
    record.live = {
      pty: fake.pty,
      pid: fake.pty.pid,
      pauseOutput: fake.pauseOutput,
      resumeOutput: fake.resumeOutput,
      tty: null,
      ttyIdentity: null,
      processIdentity: null,
      processMetadata: Promise.resolve(null),
      exit: fake.exit,
      processTreeExit: fake.processTreeExit,
      resourceDrain: fake.resourceDrain,
      outputPaused: false,
    }
    record.exitCode = 9
    record.readinessPhase = 'ready'
    record.readinessGeneration = record.spawnGeneration
    record.pendingInput = [{ data: 'already queued' }]
    record.pendingInputBytes = 14

    expect(runtime.writeInput(record, 'new input')).toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'terminal-not-open',
    })
    runtime.resumeInput(record)
    expect(runtime.forceReleaseInput(record)).toEqual({
      status: 'terminal-not-open',
      releasedBytes: 0,
    })
    expect(record.pendingInput).toEqual([{ data: 'already queued' }])
    expect(fake.write).not.toHaveBeenCalled()
  })
})
