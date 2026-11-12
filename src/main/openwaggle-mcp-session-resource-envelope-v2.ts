import { ATTACHMENT } from '@shared/constants/resource-limits'
import { hasUniqueCollaborationStrings } from '@shared/session-collaboration-collections'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import {
  isNonBlankSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_MIN_LENGTH,
} from '@shared/session-title'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { boundedArray, boundedString, check, jsonValue } from './json-schema-primitives'

export const MCP_SESSION_INPUT_LIMITS_V2 = {
  idLength: SESSION_INPUT_LIMITS.idLength,
  titleLength: SESSION_TITLE_MAX_LENGTH,
  textLength: SESSION_INPUT_LIMITS.mcpTextLength,
  itemTextLength: SESSION_INPUT_LIMITS.itemTextLength,
  arrayItems: SESSION_INPUT_LIMITS.arrayItems,
  evidenceItems: SESSION_INPUT_LIMITS.arrayItems,
  resourceReferences: SESSION_INPUT_LIMITS.arrayItems,
  jsonLength: SESSION_INPUT_LIMITS.jsonLength,
} as const

export const mcpSessionIdSchemaV2 = boundedString({
  min: 1,
  max: MCP_SESSION_INPUT_LIMITS_V2.idLength,
})
export const mcpSessionTitleSchemaV2 = boundedString({
  min: SESSION_TITLE_MIN_LENGTH,
  max: MCP_SESSION_INPUT_LIMITS_V2.titleLength,
}).pipe(check(isNonBlankSessionTitle, 'Session title must not be blank.'))
export const mcpSessionTextSchemaV2 = boundedString({
  min: 1,
  max: MCP_SESSION_INPUT_LIMITS_V2.textLength,
})
export const mcpSessionItemTextSchemaV2 = boundedString({
  min: 1,
  max: MCP_SESSION_INPUT_LIMITS_V2.itemTextLength,
})
export const mcpSessionPathSchemaV2 = boundedString({ min: 1, max: SESSION_QUERY_MAX_PATH_LENGTH })
export const mcpSessionItemArraySchemaV2 = boundedArray(
  mcpSessionItemTextSchemaV2,
  MCP_SESSION_INPUT_LIMITS_V2.arrayItems,
).pipe(check(hasUniqueCollaborationStrings, 'Collaboration items must be unique.'))
export const mcpSessionResourceReferencesSchemaV2 = boundedArray(
  mcpSessionPathSchemaV2,
  MCP_SESSION_INPUT_LIMITS_V2.resourceReferences,
).pipe(check(hasUniqueCollaborationStrings, 'Resource references must be unique.'))
export const mcpSessionAttachmentPathsSchemaV2 = boundedArray(
  mcpSessionPathSchemaV2,
  ATTACHMENT.MAX_COUNT,
).pipe(check(hasUniqueCollaborationStrings, 'Attachment paths must be unique.'))

export const mcpSessionJsonSchemaV2 = jsonValue.pipe(
  check(
    (value) => JSON.stringify(value).length <= MCP_SESSION_INPUT_LIMITS_V2.jsonLength,
    `JSON input exceeds ${String(MCP_SESSION_INPUT_LIMITS_V2.jsonLength)} characters.`,
  ),
)
