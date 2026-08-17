import { Context, type Effect } from 'effect'
import type { ActiveMcpTurn } from '../domain/mcp/turn-application-state'

/**
 * Shared authority over which MCP turns are currently in flight.
 *
 * The runtime adapter records turn begin/complete/clear as turns run; the
 * configuration adapter reads the active turn for a session so the settings
 * view can report applied/pending integration state. Both adapters share a
 * single instance through the Layer graph, replacing the former module-global
 * mutable map.
 */
export interface McpTurnStateServiceShape {
  readonly begin: (sessionId: string, revision: string | null) => Effect.Effect<void>
  readonly complete: (sessionId: string) => Effect.Effect<void>
  readonly clear: () => Effect.Effect<void>
  readonly getActive: (sessionId: string | null) => Effect.Effect<ActiveMcpTurn | undefined>
  /** Session ids that currently have an in-flight turn. */
  readonly activeSessions: () => Effect.Effect<ReadonlySet<string>>
}

export class McpTurnStateService extends Context.Tag('@openwaggle/McpTurnStateService')<
  McpTurnStateService,
  McpTurnStateServiceShape
>() {}
