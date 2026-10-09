import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberId from 'effect/FiberId'
import { describe, expect, it } from 'vitest'
import { deletionRefusalOf } from '../pi-session-discovery-store'

describe("A deletion check's refusal", () => {
  it('is the message of the error the check threw', async () => {
    const refusal = await Effect.runPromise(
      deletionRefusalOf(Exit.die(new Error('fork f1 still depends on it'))),
    )

    expect(refusal).toBe('fork f1 still depends on it')
  })

  it('is nothing when the Session can be deleted', async () => {
    expect(await Effect.runPromise(deletionRefusalOf(Exit.void))).toBeUndefined()
  })

  it('is no refusal at all when the check was interrupted: the interruption goes on', async () => {
    const exit = await Effect.runPromiseExit(deletionRefusalOf(Exit.interrupt(FiberId.none)))

    expect(Exit.isInterrupted(exit)).toBe(true)
  })
})
