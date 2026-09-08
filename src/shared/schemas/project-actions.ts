import { Schema } from '@shared/schema'
import { PROJECT_ACTION_ICONS, PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'

const looseRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
})

const trimmedNonEmptyString = (maxLength: number) =>
  Schema.String.pipe(
    Schema.maxLength(maxLength),
    Schema.filter((value) => value.trim().length > 0),
  )

const projectActionPreviewUrlSchema = trimmedNonEmptyString(
  PROJECT_ACTION_LIMITS.PREVIEW_URL_LENGTH,
).pipe(
  Schema.filter(
    (value) =>
      normalizeBrowserPreviewAddress(value) !== null ||
      'Preview URL must be a valid HTTP or HTTPS address without credentials.',
  ),
)

export const projectActionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(PROJECT_ACTION_LIMITS.ID_LENGTH),
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
)

export const projectActionIconSchema = Schema.Literal(...PROJECT_ACTION_ICONS)

export const projectActionShortcutSchema = Schema.Struct({
  key: trimmedNonEmptyString(PROJECT_ACTION_LIMITS.SHORTCUT_KEY_LENGTH),
  mod: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
})

const projectActionShortcutWhenSchema = trimmedNonEmptyString(
  PROJECT_ACTION_LIMITS.SHORTCUT_WHEN_LENGTH,
).pipe(
  Schema.filter(
    (expression) =>
      parseProjectActionWhenExpression(expression) !== null ||
      'Shortcut condition must use variables with !, &&, ||, and parentheses.',
  ),
)

export const projectActionShortcutRuleSchema = Schema.Struct({
  shortcut: projectActionShortcutSchema,
  when: Schema.optional(projectActionShortcutWhenSchema),
  order: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0),
      Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
    ),
  ),
})

const projectActionShortcutRulesSchema = Schema.mutable(
  Schema.Array(projectActionShortcutRuleSchema).pipe(
    Schema.maxItems(PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT),
  ),
)

const projectActionEditableFields = {
  name: trimmedNonEmptyString(PROJECT_ACTION_LIMITS.NAME_LENGTH),
  command: trimmedNonEmptyString(PROJECT_ACTION_LIMITS.COMMAND_LENGTH),
  icon: Schema.optional(projectActionIconSchema),
  runOnWorktreeCreate: Schema.optional(Schema.Boolean),
  previewUrl: Schema.optional(Schema.NullOr(projectActionPreviewUrlSchema)),
  autoOpenPreview: Schema.optional(Schema.Boolean),
  shortcutRules: Schema.optional(Schema.NullOr(projectActionShortcutRulesSchema)),
  shortcut: Schema.optional(Schema.NullOr(projectActionShortcutSchema)),
}

export const projectActionInputSchema = Schema.Struct(projectActionEditableFields)

export const projectActionUpdateSchema = Schema.Struct({
  name: Schema.optional(projectActionEditableFields.name),
  command: Schema.optional(projectActionEditableFields.command),
  icon: projectActionEditableFields.icon,
  runOnWorktreeCreate: projectActionEditableFields.runOnWorktreeCreate,
  previewUrl: projectActionEditableFields.previewUrl,
  autoOpenPreview: projectActionEditableFields.autoOpenPreview,
  shortcutRules: projectActionEditableFields.shortcutRules,
  shortcut: projectActionEditableFields.shortcut,
})

export const storedProjectActionSchema = Schema.Struct(
  {
    id: projectActionIdSchema,
    name: projectActionEditableFields.name,
    command: projectActionEditableFields.command,
    icon: projectActionIconSchema,
    runOnWorktreeCreate: Schema.Boolean,
    previewUrl: Schema.optional(projectActionPreviewUrlSchema),
    autoOpenPreview: Schema.optional(Schema.Boolean),
    shortcutRules: Schema.optional(projectActionShortcutRulesSchema),
    shortcut: Schema.optional(projectActionShortcutSchema),
  },
  looseRecordSchema,
)

export const storedProjectActionsSchema = Schema.mutable(
  Schema.Array(storedProjectActionSchema).pipe(
    Schema.maxItems(PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT),
    Schema.filter(
      (actions) => new Set(actions.map((action) => action.id)).size === actions.length,
      { message: () => 'Project action ids must be unique.' },
    ),
    Schema.filter((actions) => actions.filter((action) => action.runOnWorktreeCreate).length <= 1, {
      message: () => 'Only one project action may run on worktree creation.',
    }),
    Schema.filter(
      (actions) =>
        actions.reduce(
          (count, action) =>
            count + (action.shortcutRules?.length ?? (action.shortcut === undefined ? 0 : 1)),
          0,
        ) <= PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT,
      {
        message: () =>
          `A project may have at most ${String(PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT)} action shortcut rules.`,
      },
    ),
  ),
)

export const t3ProjectActionScriptSchema = Schema.Struct(
  {
    name: projectActionEditableFields.name,
    command: projectActionEditableFields.command,
    icon: Schema.optional(projectActionIconSchema),
    runOnWorktreeCreate: Schema.optional(Schema.Boolean),
    previewUrl: Schema.optional(projectActionPreviewUrlSchema),
    autoOpenPreview: Schema.optional(Schema.Boolean),
  },
  looseRecordSchema,
)

export const t3ProjectFileSchema = Schema.Struct(
  {
    scripts: Schema.optional(
      Schema.mutable(
        Schema.Array(t3ProjectActionScriptSchema).pipe(
          Schema.maxItems(PROJECT_ACTION_LIMITS.ACTIONS_PER_PROJECT),
        ),
      ),
    ),
  },
  looseRecordSchema,
)
