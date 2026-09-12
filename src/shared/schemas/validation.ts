/**
 * Centralized Effect schemas for runtime boundary validation.
 *
 * Schemas here replace cast-heavy JSON.parse / IPC / external API boundaries.
 * Consumers should decode through `safeDecodeUnknown` / `decodeUnknownOrThrow`
 * from `src/shared/schema.ts`.
 */

import { MAX_INLINE_VISUALIZATION_PATH_LENGTH } from '@shared/constants/inline-visualization'
import { Schema, type SchemaType } from '@shared/schema'
import type { AgentSendPayload } from '@shared/types/agent'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { AGENT_AUTHORIZATION_CAPABILITIES } from '@shared/types/agent-authorization-grants'
import {
  BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES,
  BROWSER_PREVIEW_CAPTURE_LIMITS,
} from '@shared/types/browser-preview-controls'
import type { JsonArray, JsonObject, JsonValue } from '@shared/types/json'
import { THINKING_LEVELS } from '@shared/types/settings'
import { storedProjectActionsSchema } from './project-actions'
import { toWaggleInvocation, waggleInvocationSchema } from './waggle'

const attachmentKindSchema = Schema.Literal('text', 'image', 'pdf')
const attachmentOriginSchema = Schema.Literal('user-file', 'auto-paste-text', 'browser-preview')
const BROWSER_PREVIEW_PAGE_URL_MAX_LENGTH = 8_192
const BROWSER_PREVIEW_PAGE_TITLE_MAX_LENGTH = 512
const BROWSER_PREVIEW_TAG_NAME_MAX_LENGTH = 64
const BROWSER_PREVIEW_ROLE_MAX_LENGTH = 128
const BROWSER_PREVIEW_SOURCE_POSITION_MAX = 10_000_000
const browserPreviewSourcePositionSchema = Schema.NullOr(
  Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(0),
    Schema.lessThanOrEqualTo(BROWSER_PREVIEW_SOURCE_POSITION_MAX),
  ),
)

const browserPreviewAttachmentSchema = Schema.Struct({
  pageUrl: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_PAGE_URL_MAX_LENGTH)),
  pageTitle: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_PAGE_TITLE_MAX_LENGTH)),
  selector: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SELECTOR_LENGTH),
  ),
  tagName: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(BROWSER_PREVIEW_TAG_NAME_MAX_LENGTH),
  ),
  role: Schema.NullOr(Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_ROLE_MAX_LENGTH))),
  elementText: Schema.String.pipe(
    Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TEXT_LENGTH),
  ),
  comment: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TEXT_LENGTH)),
  elementCount: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS),
    ),
  ),
  regionCount: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_REGIONS),
    ),
  ),
  drawingCount: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STROKES),
    ),
  ),
  styleChangeCount: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(
        BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS *
          BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES.length,
      ),
    ),
  ),
  componentName: Schema.optional(
    Schema.NullOr(
      Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_COMPONENT_LENGTH)),
    ),
  ),
  sourceFile: Schema.optional(
    Schema.NullOr(
      Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SOURCE_LENGTH)),
    ),
  ),
  sourceLine: Schema.optional(browserPreviewSourcePositionSchema),
})

const jsonArraySchema: Schema.Schema<JsonArray> = Schema.suspend(() =>
  Schema.mutable(Schema.Array(jsonValueSchema)),
)

export const jsonObjectSchema: Schema.Schema<JsonObject> = Schema.suspend(() =>
  Schema.mutable(
    Schema.Record({
      key: Schema.String,
      value: jsonValueSchema,
    }),
  ),
)

export const jsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    jsonArraySchema,
    jsonObjectSchema,
  ),
)

const jsonLooseRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
})

export const preparedAttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: attachmentKindSchema,
  origin: Schema.optional(attachmentOriginSchema),
  name: Schema.String,
  path: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  extractedText: Schema.String,
  browserPreview: Schema.optional(browserPreviewAttachmentSchema),
})

const MAX_INLINE_VISUALIZATION_STATE_BYTES = 16 * 1024
const MAX_INLINE_VISUALIZATION_TITLE_LENGTH = 250
const inlineVisualizationStateSchema = jsonValueSchema.pipe(
  Schema.filter((value) => {
    try {
      return (
        new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        MAX_INLINE_VISUALIZATION_STATE_BYTES
      )
    } catch {
      return false
    }
  }),
)

export const agentSendPayloadSchema = Schema.Struct({
  text: Schema.String,
  thinkingLevel: Schema.Literal(...THINKING_LEVELS),
  attachments: Schema.mutable(Schema.Array(preparedAttachmentSchema)),
  waggle: Schema.optional(waggleInvocationSchema),
  visualizationContext: Schema.optional(
    Schema.Struct({
      title: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_TITLE_LENGTH)),
      sourcePath: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_PATH_LENGTH)),
      state: inlineVisualizationStateSchema,
    }),
  ),
})

export function toAgentSendPayload(
  input: SchemaType<typeof agentSendPayloadSchema>,
): AgentSendPayload {
  return {
    text: input.text,
    thinkingLevel: input.thinkingLevel,
    attachments: input.attachments,
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  }
}

export const projectPreferencesSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  authorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

/** A preference write where `null` clears the key. Distinct from the read schema, which has no nulls. */
export const projectPreferencesUpdateSchema = Schema.Struct({
  model: Schema.optional(Schema.NullOr(Schema.String)),
  thinkingLevel: Schema.optional(Schema.NullOr(Schema.Literal(...THINKING_LEVELS))),
  authorizationMode: Schema.optional(Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES))),
})

export const authorizationScopeKeySchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optional(Schema.String),
})

export const scopedAuthorizationGrantSchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optional(Schema.String),
  grantedAt: Schema.Number,
})

export const projectSettingsFileSchema = Schema.Struct(
  {
    preferences: Schema.optional(projectPreferencesSchema),
    authorizationGrants: Schema.optional(
      Schema.mutable(Schema.Array(scopedAuthorizationGrantSchema)),
    ),
    pi: Schema.optional(jsonObjectSchema),
    actions: Schema.optional(storedProjectActionsSchema),
  },
  jsonLooseRecordSchema,
)
