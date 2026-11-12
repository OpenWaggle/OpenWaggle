import type { Schema } from 'effect'
import type { mcpSessionControlOperationSchemasV2 } from './openwaggle-mcp-session-input-control-schema-v2'
import type { mcpSessionQueryLifecycleOperationSchemasV2 } from './openwaggle-mcp-session-input-query-schema-v2'

/** One operation's decoded input, as a `tools/call` hands it to the handler. */
type SessionToolOperationInputV2 = Schema.Schema.Type<
  | (typeof mcpSessionQueryLifecycleOperationSchemasV2)[number]
  | (typeof mcpSessionControlOperationSchemasV2)[number]
>

type FieldName<Input> = Input extends unknown ? keyof Input : never

type FieldValue<Input, Name extends PropertyKey> = Input extends unknown
  ? Name extends keyof Input
    ? Exclude<Input[Name], undefined>
    : never
  : never

/**
 * Every operation's fields in one object: `operation`, and each other field any operation
 * declares, optional and typed as the union of what those operations accept. The payload
 * builders read fields without narrowing on `operation` first; every operation's input is
 * assignable to it.
 */
export type SessionToolInputV2 = {
  readonly operation: SessionToolOperationInputV2['operation']
} & {
  readonly [Name in Exclude<FieldName<SessionToolOperationInputV2>, 'operation'>]?: FieldValue<
    SessionToolOperationInputV2,
    Name
  >
}
