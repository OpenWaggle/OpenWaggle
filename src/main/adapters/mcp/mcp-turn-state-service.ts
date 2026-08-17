import { Effect, Layer, Ref } from 'effect'
import {
  type ActiveMcpTurn,
  activeMcpTurnFromRevision,
} from '../../domain/mcp/turn-application-state'
import {
  McpTurnStateService,
  type McpTurnStateServiceShape,
} from '../../ports/mcp-turn-state-service'

/**
 * Build a Ref-backed {@link McpTurnStateServiceShape}. Used both by the shared
 * live Layer and by the runtime service's in-memory default (tests/CLI), so the
 * runtime consumes turn state as Effects via `yield*` rather than a synchronous
 * bridge.
 */
export function makeMcpTurnState(): Effect.Effect<McpTurnStateServiceShape> {
  return Effect.gen(function* () {
    const turns = yield* Ref.make<ReadonlyMap<string, ActiveMcpTurn>>(new Map())
    return {
      begin: (sessionId, revision) =>
        Ref.update(turns, (current) =>
          new Map(current).set(sessionId, activeMcpTurnFromRevision(revision)),
        ),
      complete: (sessionId) =>
        Ref.update(turns, (current) => {
          const next = new Map(current)
          next.delete(sessionId)
          return next
        }),
      clear: () => Ref.set(turns, new Map()),
      getActive: (sessionId) =>
        Ref.get(turns).pipe(
          Effect.map((current) => (sessionId ? current.get(sessionId) : undefined)),
        ),
      activeSessions: () => Ref.get(turns).pipe(Effect.map((current) => new Set(current.keys()))),
    }
  })
}

/**
 * Ref-backed live implementation of {@link McpTurnStateService}. A single
 * instance is shared across the MCP config and runtime adapters so the settings
 * view observes in-flight turns recorded by the runtime.
 */
export const McpTurnStateServiceLive = Layer.effect(McpTurnStateService, makeMcpTurnState())
