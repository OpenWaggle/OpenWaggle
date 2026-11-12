import { hasUniqueCollaborationItemsBy } from '@shared/session-collaboration-collections'
import { Schema } from 'effect'
import { boundedArray, check, enumeration, optional } from './json-schema-primitives'
import {
  MCP_SESSION_INPUT_LIMITS_V2,
  mcpSessionIdSchemaV2,
  mcpSessionItemArraySchemaV2,
  mcpSessionResourceReferencesSchemaV2,
  mcpSessionTextSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

export const mcpDelegationSpecificationSchemaV2 = Schema.Struct({
  objective: mcpSessionTextSchemaV2,
  deliverables: mcpSessionItemArraySchemaV2,
  acceptanceCriteria: mcpSessionItemArraySchemaV2,
  dependencies: boundedArray(
    Schema.Struct({
      delegationId: mcpSessionIdSchemaV2,
      requiredState: enumeration('ready_for_review', 'accepted'),
    }),
    MCP_SESSION_INPUT_LIMITS_V2.arrayItems,
  ).pipe(
    check(
      (dependencies) =>
        hasUniqueCollaborationItemsBy(dependencies, (dependency) => dependency.delegationId),
      'Delegation dependency IDs must be unique.',
    ),
  ),
  handoffContext: optional(mcpSessionTextSchemaV2),
  resourceReferences: mcpSessionResourceReferencesSchemaV2,
})
