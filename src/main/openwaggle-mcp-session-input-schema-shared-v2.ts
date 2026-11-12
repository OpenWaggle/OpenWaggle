import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import {
  hasUniqueCollaborationStrings,
  hasUniqueCollaborationStructures,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
} from '@shared/session-collaboration-collections'
import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import {
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { Schema } from 'effect'
import {
  boundedArray,
  boundedString,
  check,
  enumeration,
  integer,
  literal,
  optional,
} from './json-schema-primitives'
import {
  MCP_SESSION_INPUT_LIMITS_V2,
  mcpSessionIdSchemaV2,
  mcpSessionItemArraySchemaV2,
  mcpSessionItemTextSchemaV2,
  mcpSessionJsonSchemaV2,
  mcpSessionPathSchemaV2,
  mcpSessionResourceReferencesSchemaV2,
  mcpSessionTextSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

export const boundedCursor = boundedString({ max: SESSION_QUERY_MAX_CURSOR_LENGTH })
export const discoveryLimit = integer({ min: 1, max: SESSION_QUERY_DISCOVERY_LIMIT })
export const transcriptLimit = integer({ min: 1, max: SESSION_QUERY_TRANSCRIPT_LIMIT })
export const revision = integer({ min: 0 })
export const positiveRevision = integer({ min: 1 })
export const timeout = integer({ min: 0, max: SESSION_QUERY_MAX_WAIT_MS })
export const interactionTimeout = integer({ min: 0, max: MAX_NODE_TIMER_DELAY_MS })
export const booleanFlag = Schema.Boolean
export const searchMode = enumeration('hybrid', 'lexical', 'semantic')
export const catalogScope = enumeration('current', 'project', 'all')
export const idempotency = { idempotencyKey: optional(mcpSessionIdSchemaV2) }
export const specialization = {
  agent: optional(mcpSessionIdSchemaV2),
  model: optional(mcpSessionIdSchemaV2),
  thinking: optional(mcpSessionIdSchemaV2),
}
export const runAuthorization = {
  yolo: optional(booleanFlag),
  runAuthorizationOverride: optional(enumeration('inherit', 'ask-for-approval', 'yolo')),
}
export const newWorktreeFields = {
  baseRef: optional(mcpSessionIdSchemaV2),
  startFromOrigin: optional(booleanFlag),
}

const responseText = boundedString({ max: MCP_SESSION_INPUT_LIMITS_V2.textLength })

export const interactionResponseSchema = Schema.Union(
  Schema.Struct({
    kind: literal('confirm'),
    accepted: Schema.Boolean,
    scope: optional(boundedString({ max: MCP_SESSION_INPUT_LIMITS_V2.itemTextLength })),
  }),
  Schema.Struct({ kind: literal('select'), selected: Schema.NullOr(responseText) }),
  Schema.Struct({ kind: literal('input'), value: Schema.NullOr(responseText) }),
  Schema.Struct({ kind: literal('editor'), value: Schema.NullOr(responseText) }),
  Schema.Struct({ kind: literal('notify'), acknowledged: literal(true) }),
  Schema.Struct({ kind: literal('custom'), value: Schema.NullOr(mcpSessionJsonSchemaV2) }),
)

export const evidenceSchema = Schema.Struct({
  kind: enumeration(
    'observed-command',
    'workspace-diff',
    'artifact',
    'source-reference',
    'asserted-note',
  ),
  summary: mcpSessionItemTextSchemaV2,
  reference: optional(mcpSessionPathSchemaV2),
})
export const evidence = boundedArray(
  evidenceSchema,
  MCP_SESSION_INPUT_LIMITS_V2.evidenceItems,
).pipe(check(hasUniqueCollaborationStructures, 'Delegation evidence items must be unique.'))
export const followUpIds = boundedArray(
  mcpSessionIdSchemaV2,
  MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS,
).pipe(check((items) => new Set(items).size === items.length, 'Follow-up IDs must be unique.'))
export const targetSessionIds = boundedArray(
  mcpSessionIdSchemaV2,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
).pipe(check(hasUniqueCollaborationStrings, 'Target Session IDs must be unique.'))
export const revisedSpecificationSchema = Schema.Struct({
  objective: mcpSessionTextSchemaV2,
  deliverables: mcpSessionItemArraySchemaV2,
  acceptanceCriteria: mcpSessionItemArraySchemaV2,
  resourceReferences: mcpSessionResourceReferencesSchemaV2,
  handoffContext: optional(mcpSessionTextSchemaV2),
})
export function finiteUniqueEnumArray<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
) {
  return boundedArray(enumeration(...values), values.length).pipe(
    check((items) => new Set(items).size === items.length, 'Filter values must be unique.'),
  )
}

export const delegationStates = finiteUniqueEnumArray(DELEGATION_STATES)

export function operationSchema<TName extends string, TFields extends Schema.Struct.Fields>(
  operation: TName,
  fields: TFields,
) {
  return Schema.Struct({ operation: literal(operation), ...fields })
}
