import type { TerminalInputIdentity, TerminalWriteResult } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTerminalInputDispatcher } from '@/features/terminal/lib/terminal-input-dispatcher'
import {
  feed,
  OWNER,
  openInput,
  ptys,
  readinessMarker,
  service,
  setDeliveryCount,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  teardownTerminalServiceActionsTest,
  workDirA,
} from '../../../../../../main/adapters/terminal/__tests__/terminal-service-actions-test-harness'

beforeEach(setupTerminalServiceActionsTest)
afterEach(teardownTerminalServiceActionsTest)

describe('terminal input across native record recreation', () => {
  it('accepts fresh input after a hidden terminal is archived and reopened', async () => {
    const dispatcher = createTerminalInputDispatcher((owner, id, data, identity, intent) =>
      Effect.runPromise(service.write(owner, id, data, identity, intent)),
    )
    const first = dispatcher.acquire(OWNER, TERMINAL_ID)
    const initial = await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: first.generation }),
    )
    await settle()
    feed(0, readinessMarker(0))
    first.markOpen(initial.readiness, initial.pendingInputBytes, initial.inputIncarnation)
    first.enqueue('original\r')
    await settle()
    expect(ptys[0]?.write).toHaveBeenCalledWith('original\r')
    expect(first.snapshot().queuedChunks).toBe(0)

    first.release()
    setDeliveryCount(0)
    await Effect.runPromise(service.closeAllForOwner(OWNER, false))
    const reopened = dispatcher.acquire(OWNER, TERMINAL_ID)
    const replacement = await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: reopened.generation }),
    )
    await settle()
    feed(1, readinessMarker(1))
    reopened.markOpen(
      replacement.readiness,
      replacement.pendingInputBytes,
      replacement.inputIncarnation,
    )
    reopened.enqueue('reopened\r')
    await settle()

    expect(reopened.snapshot().error).toBeNull()
    expect(ptys[1]?.write).toHaveBeenCalledWith('reopened\r')
    expect(reopened.snapshot().queuedChunks).toBe(0)
    dispatcher.clearOwner(OWNER)
  })

  it('rejects old writes and ignores a late acknowledgement after record replacement', async () => {
    const held = Promise.withResolvers<TerminalWriteResult>()
    let oldResult: TerminalWriteResult | undefined
    let oldIdentity: TerminalInputIdentity | undefined
    const dispatcher = createTerminalInputDispatcher(async (owner, id, data, identity) => {
      const result = await Effect.runPromise(service.write(owner, id, data, identity))
      if (data === 'old\r') {
        oldResult = result
        oldIdentity = identity
        return held.promise
      }
      return result
    })
    const client = dispatcher.acquire(OWNER, TERMINAL_ID)
    const initial = await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: client.generation }),
    )
    await settle()
    feed(0, readinessMarker(0))
    client.markOpen(initial.readiness, 0, initial.inputIncarnation)
    client.enqueue('old\r')
    await settle()
    expect(ptys[0]?.write).toHaveBeenCalledWith('old\r')
    setDeliveryCount(0)
    await Effect.runPromise(service.closeAllForOwner(OWNER, false))
    client.markOpening()
    const replacement = await Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration: client.generation }),
    )
    await settle()
    feed(1, readinessMarker(1))
    client.markOpen(replacement.readiness, 0, replacement.inputIncarnation)
    if (oldResult === undefined || oldIdentity === undefined) throw new Error('Missing old write')
    expect(
      await Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'old\r', oldIdentity)),
    ).toMatchObject({ status: 'rejected', reason: 'stale-generation' })
    expect(client.enqueue('unsafe suffix')).toMatchObject({ status: 'rejected' })
    client.markOpening()
    client.markOpen(replacement.readiness, 0, replacement.inputIncarnation)
    client.enqueue('new\r')
    await settle()
    expect(ptys[1]?.write.mock.calls).toEqual([['new\r']])
    held.resolve(oldResult)
    await settle()
    expect(client.snapshot()).toMatchObject({ error: null, queuedChunks: 0 })
    dispatcher.clearOwner(OWNER)
  })
})
