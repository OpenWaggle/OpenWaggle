import { Schema, type SchemaType } from '@shared/schema'
import { Option } from 'effect'

const unchecked = Schema.optional(Schema.Unknown)

/**
 * The fields of MCP JSON-RPC params and results that the connection pool reads. The pool forwards
 * messages between Pi's clients and a server without owning their shape, so each value stays
 * unknown and the reader checks the one it uses; a message that is not an object has none.
 */
const mcpMessageFieldsSchema = Schema.Struct({
  cursor: unchecked,
  nextCursor: unchecked,
  protocolVersion: unchecked,
  capabilities: unchecked,
  _meta: unchecked,
  progressToken: unchecked,
  requestId: unchecked,
  tools: unchecked,
})

export type McpMessageFields = SchemaType<typeof mcpMessageFieldsSchema>

const decodeFields = Schema.decodeUnknownOption(mcpMessageFieldsSchema)

export function mcpMessageFields(value: unknown): McpMessageFields | undefined {
  return Option.getOrUndefined(decodeFields(value))
}

/** A string field, or undefined. */
export function stringField(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
