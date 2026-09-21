import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import {
  hasUniqueCollaborationStrings,
  hasUniqueCollaborationStructures,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
} from '@shared/session-collaboration-collections'
import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import { MAX_FOLLOW_UP_QUEUE_ITEMS } from '@shared/types/session-control-queue'
import {
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { z } from 'zod'
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

export const boundedCursor = z.string().max(SESSION_QUERY_MAX_CURSOR_LENGTH)
export const discoveryLimit = z.number().int().min(1).max(SESSION_QUERY_DISCOVERY_LIMIT)
export const transcriptLimit = z.number().int().min(1).max(SESSION_QUERY_TRANSCRIPT_LIMIT)
export const revision = z.number().int().min(0)
export const positiveRevision = z.number().int().min(1)
export const timeout = z.number().int().min(0).max(SESSION_QUERY_MAX_WAIT_MS)
export const interactionTimeout = z.number().int().min(0).max(MAX_NODE_TIMER_DELAY_MS)
export const booleanFlag = z.boolean()
export const searchMode = z.enum(['hybrid', 'lexical', 'semantic'])
export const catalogScope = z.enum(['current', 'project', 'all'])
export const idempotency = { idempotencyKey: mcpSessionIdSchemaV2.optional() }
export const specialization = {
  agent: mcpSessionIdSchemaV2.optional(),
  model: mcpSessionIdSchemaV2.optional(),
  thinking: mcpSessionIdSchemaV2.optional(),
}
export const runAuthorization = {
  yolo: booleanFlag.optional(),
  runAuthorizationOverride: z.enum(['inherit', 'ask-for-approval', 'yolo']).optional(),
}
export const newWorktreeFields = {
  baseRef: mcpSessionIdSchemaV2.optional(),
  startFromOrigin: booleanFlag.optional(),
}

export const interactionResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('confirm'),
      accepted: z.boolean(),
      scope: z.string().max(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('select'),
      selected: z.string().max(MCP_SESSION_INPUT_LIMITS_V2.textLength).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('input'),
      value: z.string().max(MCP_SESSION_INPUT_LIMITS_V2.textLength).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('editor'),
      value: z.string().max(MCP_SESSION_INPUT_LIMITS_V2.textLength).nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('notify'), acknowledged: z.literal(true) }).strict(),
  z.object({ kind: z.literal('custom'), value: mcpSessionJsonSchemaV2.nullable() }).strict(),
])

export const evidenceSchema = z
  .object({
    kind: z.enum([
      'observed-command',
      'workspace-diff',
      'artifact',
      'source-reference',
      'asserted-note',
    ]),
    summary: mcpSessionItemTextSchemaV2,
    reference: mcpSessionPathSchemaV2.optional(),
  })
  .strict()
export const evidence = z
  .array(evidenceSchema)
  .max(MCP_SESSION_INPUT_LIMITS_V2.evidenceItems)
  .refine(hasUniqueCollaborationStructures, 'Delegation evidence items must be unique.')
export const followUpIds = z
  .array(mcpSessionIdSchemaV2)
  .max(MAX_FOLLOW_UP_QUEUE_ITEMS)
  .refine((items) => new Set(items).size === items.length, 'Follow-up IDs must be unique.')
export const targetSessionIds = z
  .array(mcpSessionIdSchemaV2)
  .max(SESSION_COLLABORATION_COLLECTION_LIMIT)
  .refine(hasUniqueCollaborationStrings, 'Target Session IDs must be unique.')
export const revisedSpecificationSchema = z
  .object({
    objective: mcpSessionTextSchemaV2,
    deliverables: mcpSessionItemArraySchemaV2,
    acceptanceCriteria: mcpSessionItemArraySchemaV2,
    resourceReferences: mcpSessionResourceReferencesSchemaV2,
    handoffContext: mcpSessionTextSchemaV2.optional(),
  })
  .strict()
export function finiteUniqueEnumArray<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
) {
  return z
    .array(z.enum(values))
    .max(values.length)
    .refine((items) => new Set(items).size === items.length, 'Filter values must be unique.')
}

export const delegationStates = finiteUniqueEnumArray(DELEGATION_STATES)

export function operationSchema<TName extends string, TShape extends z.ZodRawShape>(
  operation: TName,
  shape: TShape,
) {
  return z.object({ operation: z.literal(operation), ...shape }).strict()
}
