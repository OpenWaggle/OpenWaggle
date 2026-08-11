import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeMcpTurnState } from '../mcp-turn-state-service'
import type { McpRemoteTaskStore } from '../runtime/remote-task-store'
import { makeMcpRuntimeService } from '../runtime/runtime-service-factory'
import { connection, snapshot } from './mcp-runtime-test-utils'

const emptyStore = (): McpRemoteTaskStore => ({
  list: async () => [],
  upsert: async (records) => records,
  setDisabled: async () => undefined,
  setAllDisabled: async () => undefined,
})

describe('runtime turn lifecycle cleanup', () => {
  it('settles the turn and disposes the session when turn preparation fails', async () => {
    const program = Effect.gen(function* () {
      const turnState = yield* makeMcpTurnState()
      const failingStore: McpRemoteTaskStore = {
        ...emptyStore(),
        setDisabled: async () => {
          throw new Error('task store unavailable')
        },
      }
      const service = yield* makeMcpRuntimeService({
        connect: async () => connection(),
        turnState,
        remoteTaskStore: failingStore,
      })
      const turn = snapshot()
      const exit = yield* Effect.exit(
        service.prepareTurn({ sessionId: turn.sessionId, snapshot: turn }),
      )
      const active = yield* turnState.getActive(turn.sessionId)
      return { failed: exit._tag === 'Failure', active }
    })

    const result = await Effect.runPromise(program)
    // The failure surfaces (not swallowed) and the turn is not left pending.
    expect(result.failed).toBe(true)
    expect(result.active).toBeUndefined()
  })

  it('records the active turn on a successful prepareTurn and clears it on complete', async () => {
    const program = Effect.gen(function* () {
      const turnState = yield* makeMcpTurnState()
      const service = yield* makeMcpRuntimeService({
        connect: async () => connection(),
        turnState,
        remoteTaskStore: emptyStore(),
      })
      const turn = snapshot()
      yield* service.prepareTurn({ sessionId: turn.sessionId, snapshot: turn })
      const activeDuring = yield* turnState.getActive(turn.sessionId)
      yield* service.completeTurn({ sessionId: turn.sessionId, nextSnapshot: null })
      const activeAfter = yield* turnState.getActive(turn.sessionId)
      return { activeDuring, activeAfter }
    })

    const result = await Effect.runPromise(program)
    expect(result.activeDuring).toMatchObject({ applied: 'on' })
    expect(result.activeAfter).toBeUndefined()
  })
})
