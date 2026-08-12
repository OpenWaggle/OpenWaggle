import type { McpJsonValue, McpTurnSnapshotServer } from '@shared/types/mcp'
import { Effect } from 'effect'
import { toMcpRuntimeError } from '../../../ports/mcp-errors'

export function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function values(value: McpJsonValue, key: string) {
  return isObject(value) && Array.isArray(value[key]) ? value[key] : []
}

/** Wrap a single SDK connection call (the external Promise edge) as an Effect. */
export function fromConnection<A>(operation: string, thunk: () => Promise<A>) {
  return Effect.tryPromise({ try: thunk, catch: (error) => toMcpRuntimeError(operation, error) })
}

export function attribution(server: McpTurnSnapshotServer) {
  return { serverInstanceId: server.instanceId, serverLabel: server.name }
}
