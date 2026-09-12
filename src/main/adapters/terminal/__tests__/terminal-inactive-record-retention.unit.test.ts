import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLD_REPLAY_STATE_BOUNDARY } from '../terminal-replay'
import {
  feed,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  readinessMarker,
  service,
  setDeliveryCount,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

const SURFACE_ID = 17

async function attach(key = TERMINAL_KEY) {
  await Effect.runPromise(service.attachSurface(key, SURFACE_ID))
}

async function detach(ownerKey = OWNER) {
  await Effect.runPromise(service.detachTerminal(ownerKey, TERMINAL_ID, SURFACE_ID))
}

describe('inactive terminal record retention', () => {
  beforeEach(() =>
    setupTerminalServiceActionsTest({
      maxInactiveRecords: 0,
      maxInactiveScrollbackBytes: 0,
    }),
  )
  afterEach(teardownTerminalServiceActionsTest)

  it('keeps an attached exit, then evicts after detach and cold-replays durable history', async () => {
    await attach()
    await open(workDirA)
    await settle()
    feed(0, 'persisted output')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    await service.history.flush()
    await service.history.read(TERMINAL_KEY)
    ptys[0]?.emitExit(0)
    await settle()

    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(service.records.get(TERMINAL_KEY)?.inFlightOutput).not.toBeNull()

    await detach()
    await vi.waitFor(() => expect(service.records.has(TERMINAL_KEY)).toBe(false))
    await vi.waitFor(() => {
      expect(service.history.cacheSnapshotForTests()).toEqual({
        states: [],
        workingDirectories: [],
      })
    })

    const cold = await open(workDirA)

    expect(cold.history).toContain('persisted output')
    expect(cold.history).toContain(COLD_REPLAY_STATE_BOUNDARY)
    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(ptys).toHaveLength(2)
  })

  it('evicts only after zero-delivery output drains through its automatic ACK', async () => {
    setDeliveryCount(0)
    await open(workDirA)
    await settle()
    feed(0, 'final output')
    ptys[0]?.emitExit(0)
    await settle()

    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(service.records.get(TERMINAL_KEY)?.pendingOutput).toBe('final output')

    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    await vi.waitFor(() => expect(service.records.has(TERMINAL_KEY)).toBe(false))
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('final output')
  })

  it('moves attachment ownership and removes stale alias and input receipts on eviction', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const draftKey = `${draftOwner}::${TERMINAL_ID}`
    const sessionKey = `${sessionOwner}::${TERMINAL_ID}`
    const identity = { generation: 'renderer-a', sequence: 0 } as const
    await attach(draftKey)
    await Effect.runPromise(
      service.open({
        ...openInput(workDirA),
        ownerKey: draftOwner,
        inputGeneration: identity.generation,
      }),
    )
    await settle()
    feed(0, readinessMarker(0))
    await expect(
      Effect.runPromise(service.write(draftOwner, TERMINAL_ID, 'echo once\r', identity)),
    ).resolves.toMatchObject({ status: 'written', identity })

    await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    ptys[0]?.emitExit(0)
    await settle()

    expect(service.records.has(sessionKey)).toBe(true)

    await detach(sessionOwner)
    await vi.waitFor(() => expect(service.records.has(sessionKey)).toBe(false))
    await Effect.runPromise(
      service.open({
        ...openInput(workDirA),
        ownerKey: draftOwner,
        inputGeneration: identity.generation,
      }),
    )

    expect(service.records.has(draftKey)).toBe(true)
    expect(service.records.has(sessionKey)).toBe(false)
    await expect(
      Effect.runPromise(service.write(draftOwner, TERMINAL_ID, 'echo once\r', identity)),
    ).resolves.toMatchObject({ status: 'queued', identity })
  })

  it('keeps acknowledged pending input until an explicit restart can release it', async () => {
    await open(workDirA)
    await settle()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'promised input')),
    ).resolves.toMatchObject({ status: 'queued' })

    ptys[0]?.emitExit(1)
    await settle()

    expect(service.records.get(TERMINAL_KEY)?.pendingInputBytes).toBe(14)
    expect(service.records.has(TERMINAL_KEY)).toBe(true)
  })

  it('evicts even when releasing the non-durable history cache fails', async () => {
    const failure = new Error('cache release failed')
    service.history.release = vi.fn(() => Promise.reject(failure))
    await open(workDirA)
    await settle()

    ptys[0]?.emitExit(0)
    await settle()

    await vi.waitFor(() => expect(service.records.has(TERMINAL_KEY)).toBe(false))
    expect(service.history.release).toHaveBeenCalledExactlyOnceWith(TERMINAL_KEY)
  })
})
