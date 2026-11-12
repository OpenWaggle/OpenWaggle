/**
 * Centralized Effect schemas for runtime boundary validation.
 *
 * Schemas here replace cast-heavy JSON.parse / IPC / external API boundaries.
 * Consumers should decode through `safeDecodeUnknown` / `decodeUnknownOrThrow`
 * from `src/shared/schema.ts`.
 */

import {
  MAX_INLINE_VISUALIZATION_PATH_LENGTH,
  MAX_INLINE_VISUALIZATION_STATE_BYTES,
} from '@shared/constants/inline-visualization'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { Schema, type SchemaType } from '@shared/schema'
import type { AgentSendPayload } from '@shared/types/agent'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { AGENT_AUTHORIZATION_CAPABILITIES } from '@shared/types/agent-authorization-grants'
import {
  BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES,
  BROWSER_PREVIEW_CAPTURE_LIMITS,
} from '@shared/types/browser-preview-controls'
import type { JsonArray, JsonObject, JsonValue } from '@shared/types/json'
import { storedProjectActionsSchema } from './project-actions'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputPathSchema,
  sessionInputTextSchema,
} from './session-input'
import { toWaggleInvocation, waggleInvocationSchema } from './waggle'

const attachmentKindSchema = Schema.Literal('text', 'image', 'pdf')
const attachmentOriginSchema = Schema.Literal(
  'user-file',
  'auto-paste-text',
  'browser-preview',
  'session-resource',
)
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

export const browserPreviewAttachmentSchema = Schema.Struct({
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
  elementCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS),
    ),
    { exact: true },
  ),
  regionCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_REGIONS),
    ),
    { exact: true },
  ),
  drawingCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STROKES),
    ),
    { exact: true },
  ),
  styleChangeCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(
        BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS *
          BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES.length,
      ),
    ),
    { exact: true },
  ),
  componentName: Schema.optionalWith(
    Schema.NullOr(
      Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_COMPONENT_LENGTH)),
    ),
    { exact: true },
  ),
  sourceFile: Schema.optionalWith(
    Schema.NullOr(
      Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SOURCE_LENGTH)),
    ),
    { exact: true },
  ),
  sourceLine: Schema.optionalWith(browserPreviewSourcePositionSchema, { exact: true }),
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
  id: sessionInputIdSchema,
  kind: attachmentKindSchema,
  origin: Schema.optionalWith(attachmentOriginSchema, { exact: true }),
  name: sessionInputItemTextSchema,
  path: sessionInputPathSchema,
  mimeType: sessionInputItemTextSchema,
  sizeBytes: Schema.Number.pipe(Schema.int(), Schema.between(0, ATTACHMENT.MAX_SIZE_BYTES)),
  contentSha256: Schema.optionalWith(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)), {
    exact: true,
  }),
  extractedText: Schema.String.pipe(Schema.maxLength(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)),
  browserPreview: Schema.optionalWith(browserPreviewAttachmentSchema, { exact: true }),
})

const MAX_INLINE_VISUALIZATION_TITLE_LENGTH = 250
/** Bounded JSON a visualization reports; the same bound applies when the host restores it. */
export const inlineVisualizationStateSchema = jsonValueSchema.pipe(
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

export const inlineVisualizationContextSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_TITLE_LENGTH)),
  sourcePath: Schema.String.pipe(Schema.maxLength(MAX_INLINE_VISUALIZATION_PATH_LENGTH)),
  state: inlineVisualizationStateSchema,
})

export const agentSendPayloadSchema = Schema.Struct({
  text: sessionInputTextSchema,
  attachments: Schema.mutable(
    Schema.Array(preparedAttachmentSchema).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
  ),
  waggle: Schema.optionalWith(waggleInvocationSchema, { exact: true }),
  visualizationContext: Schema.optionalWith(inlineVisualizationContextSchema, { exact: true }),
})

export function toAgentSendPayload(input: SchemaType<typeof agentSendPayloadSchema>) {
  const payload: AgentSendPayload = {
    text: input.text,
    attachments: input.attachments,
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  }
  return payload
}

export const projectPreferencesSchema = Schema.Struct({
  model: Schema.optionalWith(Schema.String, { exact: true }),
  authorizationMode: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
})

/** A preference write where `null` clears the key. Distinct from the read schema, which has no nulls. */
export const projectPreferencesUpdateSchema = Schema.Struct({
  model: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
  authorizationMode: Schema.optionalWith(
    Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
    { exact: true },
  ),
})

const positiveSafeIntegerSchema = Schema.Number.pipe(
  Schema.filter((value) =>
    Number.isSafeInteger(value) && value > 0 ? true : 'Must be a positive safe integer.',
  ),
)

export const projectSessionHostPolicySchema = Schema.Struct({
  multiAgentEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  parentConcurrencyLimit: Schema.optionalWith(positiveSafeIntegerSchema, { exact: true }),
})

export const authorizationScopeKeySchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optionalWith(Schema.String, { exact: true }),
})

export const scopedAuthorizationGrantSchema = Schema.Struct({
  requester: Schema.String,
  requesterId: Schema.String,
  capability: Schema.Literal(...AGENT_AUTHORIZATION_CAPABILITIES),
  resource: Schema.optionalWith(Schema.String, { exact: true }),
  grantedAt: Schema.Number,
})

export const projectSettingsFileSchema = Schema.Struct(
  {
    preferences: Schema.optionalWith(projectPreferencesSchema, { exact: true }),
    sessionHost: Schema.optionalWith(projectSessionHostPolicySchema, { exact: true }),
    authorizationGrants: Schema.optionalWith(
      Schema.mutable(Schema.Array(scopedAuthorizationGrantSchema)),
      { exact: true },
    ),
    pi: Schema.optionalWith(jsonObjectSchema, { exact: true }),
    actions: Schema.optionalWith(storedProjectActionsSchema, { exact: true }),
    /**
     * Shared Source control host declarations and Change request open destination (ADR 0048).
     * Kept loose here and read entry by entry, so one bad entry never invalidates the file.
     */
    sourceControl: Schema.optionalWith(jsonObjectSchema, { exact: true }),
  },
  jsonLooseRecordSchema,
)
