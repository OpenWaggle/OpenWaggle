import { z } from 'zod'
import {
  MCP_SESSION_INPUT_LIMITS_V2,
  mcpSessionIdSchemaV2,
  mcpSessionItemArraySchemaV2,
  mcpSessionResourceReferencesSchemaV2,
  mcpSessionTextSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

export const mcpDelegationSpecificationSchemaV2 = z
  .object({
    objective: mcpSessionTextSchemaV2,
    deliverables: mcpSessionItemArraySchemaV2,
    acceptanceCriteria: mcpSessionItemArraySchemaV2,
    dependencies: z
      .array(
        z
          .object({
            delegationId: mcpSessionIdSchemaV2,
            requiredState: z.enum(['ready_for_review', 'accepted']),
          })
          .strict(),
      )
      .max(MCP_SESSION_INPUT_LIMITS_V2.arrayItems),
    handoffContext: mcpSessionTextSchemaV2.optional(),
    resourceReferences: mcpSessionResourceReferencesSchemaV2,
  })
  .strict()
