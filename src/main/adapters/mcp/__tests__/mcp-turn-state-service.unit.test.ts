import { Context, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { McpTurnStateService } from '../../../ports/mcp-turn-state-service'
import { McpTurnStateServiceLive } from '../mcp-turn-state-service'

describe('McpTurnStateServiceLive', () => {
  it('records, reads, and clears active turns', async () => {
    const program = Effect.gen(function* () {
      const service = yield* McpTurnStateService
      yield* service.begin('session-a', 'rev-1')
      const active = yield* service.getActive('session-a')
      const missing = yield* service.getActive('session-b')
      yield* service.complete('session-a')
      const afterComplete = yield* service.getActive('session-a')
      yield* service.begin('session-c', null)
      yield* service.clear()
      const afterClear = yield* service.getActive('session-c')
      return { active, missing, afterComplete, afterClear }
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(McpTurnStateServiceLive)))

    expect(result.active).toEqual({ applied: 'on', revision: 'rev-1' })
    expect(result.missing).toBeUndefined()
    expect(result.afterComplete).toBeUndefined()
    expect(result.afterClear).toBeUndefined()
  })

  it('reports applied "off" for a turn that began with no snapshot revision', async () => {
    const program = Effect.gen(function* () {
      const service = yield* McpTurnStateService
      yield* service.begin('session-off', null)
      return yield* service.getActive('session-off')
    })

    const active = await Effect.runPromise(program.pipe(Effect.provide(McpTurnStateServiceLive)))
    expect(active).toEqual({ applied: 'off', revision: null })
  })

  it('shares a single instance across consumers when provided once to a merged layer', async () => {
    // Mirrors the runtime.ts wiring: two adapters depend on McpTurnStateService
    // and must observe each other's turns through one shared instance.
    class Writer extends Context.Tag('test/Writer')<
      Writer,
      { readonly begin: (sessionId: string, revision: string | null) => Effect.Effect<void> }
    >() {}
    class Reader extends Context.Tag('test/Reader')<
      Reader,
      { readonly isActive: (sessionId: string) => Effect.Effect<boolean> }
    >() {}

    const WriterLive = Layer.effect(
      Writer,
      Effect.gen(function* () {
        const turnState = yield* McpTurnStateService
        return Writer.of({ begin: (sessionId, revision) => turnState.begin(sessionId, revision) })
      }),
    )
    const ReaderLive = Layer.effect(
      Reader,
      Effect.gen(function* () {
        const turnState = yield* McpTurnStateService
        return Reader.of({
          isActive: (sessionId) =>
            turnState.getActive(sessionId).pipe(Effect.map((turn) => turn !== undefined)),
        })
      }),
    )
    const graph = Layer.mergeAll(WriterLive, ReaderLive).pipe(
      Layer.provide(McpTurnStateServiceLive),
    )

    const program = Effect.gen(function* () {
      const writer = yield* Writer
      const reader = yield* Reader
      yield* writer.begin('shared-session', 'rev-9')
      return yield* reader.isActive('shared-session')
    })

    const observed = await Effect.runPromise(program.pipe(Effect.provide(graph)))
    expect(observed).toBe(true)
  })
})
