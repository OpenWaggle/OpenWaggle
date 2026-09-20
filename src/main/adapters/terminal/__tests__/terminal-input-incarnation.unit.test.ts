import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  events,
  feed,
  OWNER,
  openInput,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

const generation = 'renderer-incarnation-test'

async function openIncarnation() {
  const snapshot = await Effect.runPromise(
    service.open({ ...openInput(workDirA), inputGeneration: generation }),
  )
  expect(snapshot.inputIncarnation).toMatch(/^[0-9a-f-]{36}$/u)
  if (!snapshot.inputIncarnation) throw new Error('Missing native input incarnation')
  await settle()
  return snapshot.inputIncarnation
}

describe('terminal native input incarnation', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('preserves incarnation and ambiguous-write receipts through detach, reattach, and Restart', async () => {
    const incarnation = await openIncarnation()
    feed(0, readinessMarker(0))
    expect(events).toContainEqual({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      event: {
        type: 'readiness',
        readiness: { phase: 'ready', generation: 1 },
        inputIncarnation: incarnation,
      },
    })
    const identity = { generation, incarnation, sequence: 0 }
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'accepted', identity)),
    ).resolves.toMatchObject({ status: 'written' })
    await Effect.runPromise(service.detachTerminal(OWNER, TERMINAL_ID, 42))
    expect(await openIncarnation()).toBe(incarnation)
    expect(spawn).toHaveBeenCalledOnce()
    const restarted = await Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration: generation }),
    )
    expect(restarted.inputIncarnation).toBe(incarnation)
    await settle()
    feed(1, readinessMarker(1))
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'accepted', identity)),
    ).resolves.toMatchObject({ status: 'written' })
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('accepted')
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'next', { ...identity, sequence: 1 })),
    ).resolves.toMatchObject({ status: 'written' })
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('next')
  })

  it('creates a new incarnation after native deletion and rejects even old sequence-zero writes', async () => {
    const oldIncarnation = await openIncarnation()
    await Effect.runPromise(service.closeAllForOwner(OWNER, false))
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    const incarnation = await openIncarnation()
    expect(incarnation).not.toBe(oldIncarnation)
    feed(1, readinessMarker(1))
    const oldIdentity = { generation, incarnation: oldIncarnation, sequence: 0 }
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'late old command', oldIdentity)),
    ).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'stale-generation',
      identity: oldIdentity,
    })
    expect(service.records.get(TERMINAL_KEY)?.lastInputReceipt).toBeNull()
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('late old command')
    const identity = { generation, incarnation, sequence: 0 }
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'new command', identity)),
    ).resolves.toMatchObject({ status: 'written' })
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'different', identity)),
    ).resolves.toMatchObject({ status: 'rejected', reason: 'sequence-conflict' })
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'gap', { ...identity, sequence: 2 })),
    ).resolves.toMatchObject({ status: 'rejected', reason: 'sequence-gap' })
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('new command')
  })

  it('rejects a tagged stale write while a replacement open has not created its record', async () => {
    const oldIncarnation = await openIncarnation()
    await Effect.runPromise(service.closeAllForOwner(OWNER, false))
    const reading = Promise.withResolvers<void>()
    const history = Promise.withResolvers<string>()
    vi.spyOn(service.history, 'read').mockImplementationOnce(() => {
      reading.resolve()
      return history.promise
    })
    const opening = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: generation }),
    )
    await reading.promise
    try {
      expect(service.records.has(TERMINAL_KEY)).toBe(false)
      await expect(
        Effect.runPromise(
          service.write(OWNER, TERMINAL_ID, 'late pre-open input', {
            generation,
            incarnation: oldIncarnation,
            sequence: 0,
          }),
        ),
      ).resolves.toMatchObject({ status: 'rejected', reason: 'stale-generation' })
    } finally {
      history.resolve('')
      await opening
    }
    await settle()
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('late pre-open input')
    expect(service.records.get(TERMINAL_KEY)?.lastInputReceipt).toBeNull()
  })

  it('does not let a delayed Send now for an old record drain replacement startup input', async () => {
    const oldIncarnation = await openIncarnation()
    await Effect.runPromise(service.closeAllForOwner(OWNER, false))
    const incarnation = await openIncarnation()
    const identity = { generation, incarnation, sequence: 0 }
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'new startup input', identity)),
    ).resolves.toMatchObject({ status: 'queued' })
    await expect(
      Effect.runPromise(service.sendInputNow(OWNER, TERMINAL_ID, oldIncarnation)),
    ).resolves.toEqual({ status: 'terminal-not-open', releasedBytes: 0 })
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('new startup input')
    await expect(
      Effect.runPromise(service.sendInputNow(OWNER, TERMINAL_ID, incarnation)),
    ).resolves.toEqual({ status: 'released', releasedBytes: 17 })
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('new startup input')
  })
})
