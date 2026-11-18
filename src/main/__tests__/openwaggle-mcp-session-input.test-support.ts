import { Either, Schema } from 'effect'
import { MCP_SCHEMA_PARSE_OPTIONS } from '../effect-standard-schema'
import { sessionInputSchemaV2 } from '../openwaggle-mcp-session-input-v2'

/** Whether `tools/call` arguments pass an MCP input schema's validation. */
export function acceptsInput<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  return Either.isRight(Schema.decodeUnknownEither(schema, MCP_SCHEMA_PARSE_OPTIONS)(value))
}

/** Whether `tools/call` arguments pass the Hive tool's input validation. */
export function acceptsSessionInput(value: unknown) {
  return acceptsInput(sessionInputSchemaV2, value)
}

/** The arguments as the Hive tool's handler receives them. */
export function decodeSessionInput(value: unknown) {
  return Schema.decodeUnknownSync(sessionInputSchemaV2, MCP_SCHEMA_PARSE_OPTIONS)(value)
}
