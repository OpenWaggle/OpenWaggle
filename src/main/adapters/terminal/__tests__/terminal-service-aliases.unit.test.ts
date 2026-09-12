import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  openInput,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

function key(ownerKey: string) {
  return `${ownerKey}::${TERMINAL_ID}`
}

async function openFor(ownerKey: string) {
  const result = await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey }))
  await settle()
  return result
}

describe('terminal owner alias lifetime', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('reopens a closed draft under the draft owner instead of a stale session alias', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    await openFor(draftOwner)
    await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await Effect.runPromise(service.close(sessionOwner, TERMINAL_ID, false))

    await openFor(draftOwner)

    expect(service.records.has(key(sessionOwner))).toBe(false)
    expect(service.records.get(key(draftOwner))?.ownerKey).toBe(draftOwner)
    expect(ptys).toHaveLength(2)
  })

  it('prunes aliases scoped to an owner even when that owner has no live record', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    await openFor(draftOwner)
    await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))

    await Effect.runPromise(service.closeAllForOwner(draftOwner, false))
    await openFor(draftOwner)

    expect(service.records.has(key(sessionOwner))).toBe(true)
    expect(service.records.has(key(draftOwner))).toBe(true)
  })

  it('retains only the immediately preceding owner across repeated migrations', async () => {
    const firstOwner = 'draft:/repo'
    const secondOwner = 'session-born'
    const finalOwner = 'session-rehomed'
    await openFor(firstOwner)
    await Effect.runPromise(service.migrateOwner(firstOwner, secondOwner))
    await Effect.runPromise(service.migrateOwner(secondOwner, finalOwner))

    await openFor(secondOwner)
    expect(ptys).toHaveLength(1)
    await openFor(firstOwner)

    expect(service.records.has(key(finalOwner))).toBe(true)
    expect(service.records.has(key(firstOwner))).toBe(true)
    expect(service.records.has(key(secondOwner))).toBe(false)
    expect(ptys).toHaveLength(2)
  })

  it('clears aliases when all terminals shut down', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    await openFor(draftOwner)
    await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await Effect.runPromise(service.closeAll())

    await openFor(draftOwner)

    expect(service.records.has(key(sessionOwner))).toBe(false)
    expect(service.records.has(key(draftOwner))).toBe(true)
  })
})
