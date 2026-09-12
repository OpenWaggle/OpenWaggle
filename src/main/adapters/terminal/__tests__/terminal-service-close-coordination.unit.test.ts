import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  events,
  feed,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

const { TERMINAL_FORCE_SHUTDOWN_MS, TERMINAL_GRACEFUL_SHUTDOWN_MS, TERMINAL_PROCESS_SNAPSHOT_MS } =
  await import('../terminal-process-shutdown')

describe('makeNodePtyTerminalService close coordination', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('keeps owner admission closed across an enclosing session mutation', async () => {
    await open(workDirA)
    await settle()
    const mutationReached = Promise.withResolvers<void>()
    const finishMutation = Promise.withResolvers<void>()

    const mutation = Effect.runPromise(
      service.runWithMutationFence(
        { kind: 'owner', ownerKey: OWNER },
        service.closeAllForOwner(OWNER, false).pipe(
          Effect.tap(() => Effect.sync(() => mutationReached.resolve())),
          Effect.zipRight(Effect.promise(() => finishMutation.promise)),
        ),
      ),
    )
    await mutationReached.promise

    await expect(Effect.runPromise(service.open(openInput(workDirA)))).resolves.toMatchObject({
      running: false,
    })
    expect(spawn).toHaveBeenCalledOnce()

    finishMutation.resolve()
    await mutation
  })

  it('keeps path admission closed across an enclosing worktree mutation', async () => {
    await open(workDirA)
    await settle()
    const mutationReached = Promise.withResolvers<void>()
    const finishMutation = Promise.withResolvers<void>()

    const mutation = Effect.runPromise(
      service.runWithMutationFence(
        { kind: 'path', directoryPath: workDirA },
        service.closeAllUnderPath(workDirA, false).pipe(
          Effect.tap(() => Effect.sync(() => mutationReached.resolve())),
          Effect.zipRight(Effect.promise(() => finishMutation.promise)),
        ),
      ),
    )
    await mutationReached.promise

    await expect(Effect.runPromise(service.open(openInput(workDirA)))).resolves.toMatchObject({
      running: false,
    })
    expect(spawn).toHaveBeenCalledOnce()

    finishMutation.resolve()
    await mutation
  })

  it('releases an in-flight output delivery when its renderer detaches', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'in flight')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    expect(service.records.get(TERMINAL_KEY)?.inFlightOutput).not.toBeNull()

    await Effect.runPromise(service.detachTerminal(OWNER, TERMINAL_ID, 42))

    expect(service.records.get(TERMINAL_KEY)?.inFlightOutput).toBeNull()
  })

  it('assesses dead, uncertain, idle, and active close impact in the main process', async () => {
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'safe',
      reason: 'dead',
    })
    await open(workDirA)
    await settle()
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'confirm',
      reason: 'uncertain',
      processNames: [],
      ports: [],
    })

    const record = service.records.get(TERMINAL_KEY)
    if (record === undefined) throw new Error('Expected terminal record')
    record.activity = {
      processName: null,
      processNames: [],
      ports: [],
      processPids: [],
      processIdentities: [],
      tty: 'ttys001',
      processReliable: true,
      reliable: true,
    }
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'safe',
      reason: 'idle',
    })

    record.activity = {
      processName: null,
      processNames: [],
      ports: [],
      processPids: [],
      processIdentities: [],
      tty: 'ttys001',
      processReliable: false,
      reliable: false,
    }
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'confirm',
      reason: 'uncertain',
      processNames: [],
      ports: [],
    })

    record.activity = {
      processName: 'pnpm',
      processNames: ['pnpm', 'node'],
      ports: [5173],
      processPids: [],
      processIdentities: [],
      tty: 'ttys001',
      processReliable: true,
      reliable: true,
    }
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['pnpm', 'node'],
      ports: [5173],
    })

    ptys[0]?.emitExit(0)
    await vi.advanceTimersByTimeAsync(0)
    await expect(Effect.runPromise(service.assessClose(OWNER, TERMINAL_ID))).resolves.toEqual({
      disposition: 'safe',
      reason: 'dead',
    })
  })

  it('keeps renderer-visible state addressable when PTY shutdown is rejected', async () => {
    await open(workDirA)
    await settle()
    ptys[0]?.closeDescriptor.mockImplementation(() => {
      throw new Error('descriptor close rejected')
    })

    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))
    const rejected = expect(closing).rejects.toThrow('Terminal process could not be stopped.')
    await vi.advanceTimersByTimeAsync(TERMINAL_PROCESS_SNAPSHOT_MS)
    await vi.advanceTimersByTimeAsync(TERMINAL_GRACEFUL_SHUTDOWN_MS + TERMINAL_FORCE_SHUTDOWN_MS)
    await rejected

    expect(service.records.get(TERMINAL_KEY)?.live?.pty).toBe(ptys[0]?.pty)
    expect(service.records.get(TERMINAL_KEY)?.termination).toBeNull()
    expect(ptys[0]?.closeDescriptor.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(events.some((payload) => payload.event.type === 'closed')).toBe(false)

    const first = ptys[0]
    first?.closeDescriptor.mockImplementation(() => first.emitExit(0))
    first?.emitExit(0)
    await vi.advanceTimersByTimeAsync(0)
  })
})
