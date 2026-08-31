import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { z } from 'zod'

export const MCP_SESSION_INPUT_LIMITS_V2 = {
  idLength: 512,
  titleLength: 1_024,
  textLength: 131_072,
  itemTextLength: 16_384,
  arrayItems: 256,
  evidenceItems: 256,
  resourceReferences: 256,
  jsonLength: 131_072,
} as const

export const mcpSessionIdSchemaV2 = z.string().min(1).max(MCP_SESSION_INPUT_LIMITS_V2.idLength)
export const mcpSessionTitleSchemaV2 = z
  .string()
  .min(1)
  .max(MCP_SESSION_INPUT_LIMITS_V2.titleLength)
export const mcpSessionTextSchemaV2 = z.string().min(1).max(MCP_SESSION_INPUT_LIMITS_V2.textLength)
export const mcpSessionItemTextSchemaV2 = z
  .string()
  .min(1)
  .max(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength)
export const mcpSessionPathSchemaV2 = z.string().min(1).max(SESSION_QUERY_MAX_PATH_LENGTH)
export const mcpSessionItemArraySchemaV2 = z
  .array(mcpSessionItemTextSchemaV2)
  .max(MCP_SESSION_INPUT_LIMITS_V2.arrayItems)
export const mcpSessionResourceReferencesSchemaV2 = z
  .array(mcpSessionPathSchemaV2)
  .max(MCP_SESSION_INPUT_LIMITS_V2.resourceReferences)

export const mcpSessionJsonSchemaV2 = z
  .json()
  .refine(
    (value) => JSON.stringify(value).length <= MCP_SESSION_INPUT_LIMITS_V2.jsonLength,
    `JSON input exceeds ${String(MCP_SESSION_INPUT_LIMITS_V2.jsonLength)} characters.`,
  )
