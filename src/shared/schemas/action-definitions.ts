import { Schema } from '@shared/schema'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import { projectActionIconSchema, projectActionShortcutRuleSchema } from './project-actions'

const text = (length: number) =>
  Schema.String.pipe(
    Schema.maxLength(length),
    Schema.filter((value) => value.trim().length > 0 && !value.includes('\0')),
  )
export const actionDefinitionIdSchema = text(ACTION_DEFINITION_LIMITS.ID_LENGTH).pipe(
  Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
)

/** Forward-slash, project-relative paths are also valid on Windows. */
export const actionRelativePathSchema = text(ACTION_DEFINITION_LIMITS.PATH_LENGTH).pipe(
  Schema.filter(
    (value) =>
      value === '.' ||
      (!value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes(':') &&
        value.split('/').every((part) => part !== '..' && part !== '.' && part.length > 0)),
  ),
)
export const projectTaskReferenceSchema = Schema.Struct({
  provider: Schema.Literal('package-script', 'hatch-script', 'cargo-alias'),
  source: actionRelativePathSchema,
  task: text(ACTION_DEFINITION_LIMITS.NAME_LENGTH),
  directory: actionRelativePathSchema,
  environment: Schema.optional(text(ACTION_DEFINITION_LIMITS.NAME_LENGTH)),
})
export const actionInvocationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('command'),
    command: text(ACTION_DEFINITION_LIMITS.COMMAND_LENGTH),
    directory: actionRelativePathSchema,
  }),
  Schema.Struct({ type: Schema.Literal('task'), task: projectTaskReferenceSchema }),
)
export const actionDefinitionSchema = Schema.Struct({
  id: actionDefinitionIdSchema,
  name: text(ACTION_DEFINITION_LIMITS.NAME_LENGTH),
  icon: projectActionIconSchema,
  invocation: actionInvocationSchema,
  kind: Schema.Literal('task', 'service'),
  allowConcurrent: Schema.Boolean,
  autoOpenPreview: Schema.Boolean,
  previewUrl: Schema.optional(
    text(ACTION_DEFINITION_LIMITS.PATH_LENGTH).pipe(
      Schema.filter((value) => normalizeBrowserPreviewAddress(value) !== null),
    ),
  ),
  shortcutRules: Schema.optional(Schema.Array(projectActionShortcutRuleSchema)),
}).pipe(Schema.filter((action) => action.kind !== 'service' || !action.allowConcurrent))

export const preparationProfileSchema = Schema.Struct({
  id: actionDefinitionIdSchema,
  name: text(ACTION_DEFINITION_LIMITS.NAME_LENGTH),
})
export const preparationDefinitionSchema = Schema.Struct({
  id: actionDefinitionIdSchema,
  profileId: actionDefinitionIdSchema,
  phase: Schema.Literal('setup', 'cleanup'),
  invocation: actionInvocationSchema,
})
const uniqueIds = <T extends { readonly id: string }>(entries: readonly T[]) =>
  new Set(entries.map((entry) => entry.id)).size === entries.length
export const actionManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  actions: Schema.Array(actionDefinitionSchema).pipe(
    Schema.maxItems(ACTION_DEFINITION_LIMITS.DEFINITIONS),
    Schema.filter(uniqueIds),
  ),
  profiles: Schema.Array(preparationProfileSchema).pipe(
    Schema.maxItems(ACTION_DEFINITION_LIMITS.PROFILES),
    Schema.filter(uniqueIds),
  ),
  preparation: Schema.Array(preparationDefinitionSchema).pipe(
    Schema.maxItems(ACTION_DEFINITION_LIMITS.DEFINITIONS),
    Schema.filter(uniqueIds),
    Schema.filter(
      (entries) =>
        new Set(entries.map((entry) => `${entry.profileId}:${entry.phase}`)).size ===
        entries.length,
    ),
  ),
})
export const preparationReviewSchema = Schema.Struct({
  definitionId: actionDefinitionIdSchema,
  fingerprint: Schema.String,
  invocation: actionInvocationSchema,
  enabled: Schema.Boolean,
})
const storage = Schema.Literal('local', 'project')
export const actionCatalogEditSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('move-definition'),
    collection: Schema.Literal('actions', 'profiles', 'preparation'),
    id: actionDefinitionIdSchema,
    storage,
  }),
  Schema.Struct({
    type: Schema.Literal('save-action'),
    definition: actionDefinitionSchema,
    storage,
  }),
  Schema.Struct({ type: Schema.Literal('delete-action'), id: actionDefinitionIdSchema, storage }),
  Schema.Struct({
    type: Schema.Literal('save-profile'),
    definition: preparationProfileSchema,
    storage,
  }),
  Schema.Struct({ type: Schema.Literal('delete-profile'), id: actionDefinitionIdSchema, storage }),
  Schema.Struct({
    type: Schema.Literal('save-preparation'),
    definition: preparationDefinitionSchema,
    storage,
  }),
  Schema.Struct({
    type: Schema.Literal('delete-preparation'),
    id: actionDefinitionIdSchema,
    storage,
  }),
  Schema.Struct({
    type: Schema.Literal('review-preparation'),
    id: actionDefinitionIdSchema,
    enabled: Schema.Boolean,
  }),
)
