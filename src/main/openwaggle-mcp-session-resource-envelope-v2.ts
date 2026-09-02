import { ATTACHMENT } from '@shared/constants/resource-limits'
import {
  hasUniqueCollaborationStrings,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
} from '@shared/session-collaboration-collections'
import {
  isNonBlankSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_MIN_LENGTH,
} from '@shared/session-title'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { z } from 'zod'

export const MCP_SESSION_INPUT_LIMITS_V2 = {
  idLength: 512,
  titleLength: SESSION_TITLE_MAX_LENGTH,
  textLength: 131_072,
  itemTextLength: 16_384,
  arrayItems: SESSION_COLLABORATION_COLLECTION_LIMIT,
  evidenceItems: SESSION_COLLABORATION_COLLECTION_LIMIT,
  resourceReferences: SESSION_COLLABORATION_COLLECTION_LIMIT,
  jsonLength: 131_072,
} as const

export const mcpSessionIdSchemaV2 = z.string().min(1).max(MCP_SESSION_INPUT_LIMITS_V2.idLength)
export const mcpSessionTitleSchemaV2 = z
  .string()
  .min(SESSION_TITLE_MIN_LENGTH)
  .max(MCP_SESSION_INPUT_LIMITS_V2.titleLength)
  .refine(isNonBlankSessionTitle, 'Session title must not be blank.')
export const mcpSessionTextSchemaV2 = z.string().min(1).max(MCP_SESSION_INPUT_LIMITS_V2.textLength)
export const mcpSessionItemTextSchemaV2 = z
  .string()
  .min(1)
  .max(MCP_SESSION_INPUT_LIMITS_V2.itemTextLength)
export const mcpSessionPathSchemaV2 = z.string().min(1).max(SESSION_QUERY_MAX_PATH_LENGTH)
export const mcpSessionItemArraySchemaV2 = z
  .array(mcpSessionItemTextSchemaV2)
  .max(MCP_SESSION_INPUT_LIMITS_V2.arrayItems)
  .refine(hasUniqueCollaborationStrings, 'Collaboration items must be unique.')
export const mcpSessionResourceReferencesSchemaV2 = z
  .array(mcpSessionPathSchemaV2)
  .max(MCP_SESSION_INPUT_LIMITS_V2.resourceReferences)
  .refine(hasUniqueCollaborationStrings, 'Resource references must be unique.')
export const mcpSessionAttachmentPathsSchemaV2 = z
  .array(mcpSessionPathSchemaV2)
  .max(ATTACHMENT.MAX_COUNT)
  .refine(hasUniqueCollaborationStrings, 'Attachment paths must be unique.')

export const mcpSessionJsonSchemaV2 = z
  .json()
  .refine(
    (value) => JSON.stringify(value).length <= MCP_SESSION_INPUT_LIMITS_V2.jsonLength,
    `JSON input exceeds ${String(MCP_SESSION_INPUT_LIMITS_V2.jsonLength)} characters.`,
  )
