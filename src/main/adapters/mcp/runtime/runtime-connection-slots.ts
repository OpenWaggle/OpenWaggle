import type { Deferred, Effect, SynchronizedRef } from 'effect'
import type { McpRuntimeFailure } from '../../../ports/mcp-errors'
import type { McpRuntimeConnectionStatus } from '../../../ports/mcp-runtime-service'
import type { McpClientConnection, McpConnectionFactory } from './types'

/*
 * One MCP connection slot per `namespace:revision:server` key:
 *
 *   absent --start--> active (connecting) --connected--> active (connection set)
 *                        |          \--failed--> absent
 *                        \--close (aborts the connect)--> closing --cleanup--> absent
 *
 * Opening transitions live in runtime-connection-open.ts, closing ones in
 * runtime-connection-close.ts, and the service facade in runtime-connections.ts.
 */

/**
 * A per-key Deferred with atomically coordinated connection status and lifetime.
 *
 * `abort` cancels the connect when the slot is closed before it finished, so a close never has
 * to wait out a slow server, and tells anything waiting on the attempt that it was retired
 * rather than failed.
 */
export interface ConnectionCell {
  readonly deferred: Deferred.Deferred<McpClientConnection, McpRuntimeFailure>
  readonly abort: AbortController
  readonly status: McpRuntimeConnectionStatus
  readonly connection?: McpClientConnection
}

/** A started connection: the wait for it, and the signal that fires if its slot is closed. */
export interface ConnectionAttempt {
  readonly connection: Effect.Effect<McpClientConnection, McpRuntimeFailure>
  readonly retired: AbortSignal
}

export type ConnectionSlot =
  | { readonly type: 'active'; readonly cell: ConnectionCell }
  | {
      readonly type: 'closing'
      readonly cell: ConnectionCell
      readonly done: Deferred.Deferred<void>
    }

export interface ConnectionsCtx {
  readonly connect: McpConnectionFactory
  readonly onClose: (key: string) => Effect.Effect<void>
  readonly onConnected: (runtimeNamespace: string, serverInstanceId: string) => Effect.Effect<void>
  readonly cells: SynchronizedRef.SynchronizedRef<Map<string, ConnectionSlot>>
}
