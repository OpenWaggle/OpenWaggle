import * as Effect from 'effect/Effect'
import * as FiberRef from 'effect/FiberRef'

interface SessionSemaphoreEntry {
  readonly semaphore: Effect.Semaphore
  users: number
}

const sessionSemaphores = new Map<string, SessionSemaphoreEntry>()

const emptyHeldSerializations: ReadonlyMap<string, Effect.Semaphore> = new Map()
/** The Session serializations this fiber holds, so a holder can step aside from its own. */
const heldSessionCommandSerializations = FiberRef.unsafeMake<ReadonlyMap<string, Effect.Semaphore>>(
  emptyHeldSerializations,
  {
    // A child fiber may outlive the serialized command; it must not step aside from a permit that
    // its parent owns and releases.
    fork: () => emptyHeldSerializations,
    join: (parent) => parent,
  },
)

function acquireSessionSemaphore(sessionId: string) {
  return Effect.sync(() => {
    const existing = sessionSemaphores.get(sessionId)
    if (existing) {
      existing.users += 1
      return existing
    }
    const created = { semaphore: Effect.runSync(Effect.makeSemaphore(1)), users: 1 }
    sessionSemaphores.set(sessionId, created)
    return created
  })
}

function releaseSessionSemaphore(sessionId: string, entry: SessionSemaphoreEntry) {
  return Effect.sync(() => {
    entry.users -= 1
    if (entry.users === 0 && sessionSemaphores.get(sessionId) === entry) {
      sessionSemaphores.delete(sessionId)
    }
  })
}

/**
 * Serialize one Session Control mutation against every other serialized mutation of the same
 * Session. Host-initiated mutations (such as Hive cleanup) use it so their precondition check and
 * write cannot interleave with a concurrently submitted command.
 */
export function withSessionCommandSerialization<A, E, R>(
  sessionId: string,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    acquireSessionSemaphore(sessionId),
    (entry) =>
      FiberRef.get(heldSessionCommandSerializations).pipe(
        Effect.flatMap((held) =>
          Effect.locally(
            effect,
            heldSessionCommandSerializations,
            new Map(held).set(sessionId, entry.semaphore),
          ),
        ),
        entry.semaphore.withPermits(1),
      ),
    (entry) => releaseSessionSemaphore(sessionId, entry),
  )
}

/**
 * Run `effect` with this fiber's serialization of the Session released, then take it back before
 * returning its result. For a command that must wait on a Pi writer for as long as a turn takes,
 * such as a promotion waiting for Pi to incorporate its steer: holding the serialization meanwhile
 * kept every other command for the Session waiting until then. The command must have durably
 * recorded what it is doing first (a pending promotion reserves its Follow-up), so the commands
 * admitted meanwhile see it. Without a held serialization the effect runs unchanged.
 *
 * Lock order: a dispatched command takes the attachment transition before this serialization. A
 * holder that also steps aside from the transition must do so inside this call, so it takes the
 * transition back first and the serialization last, never the other way round.
 */
export function releaseSessionCommandSerializationWhile<A, E, R>(input: {
  readonly sessionId: string
  readonly effect: Effect.Effect<A, E, R>
}) {
  return FiberRef.get(heldSessionCommandSerializations).pipe(
    Effect.flatMap((held) => {
      const semaphore = held.get(input.sessionId)
      if (!semaphore) return input.effect
      const withoutSession = new Map(held)
      withoutSession.delete(input.sessionId)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* semaphore.release(1)
          const exit = yield* Effect.exit(
            restore(Effect.locally(input.effect, heldSessionCommandSerializations, withoutSession)),
          )
          yield* semaphore.take(1)
          return yield* exit
        }),
      )
    }),
  )
}
