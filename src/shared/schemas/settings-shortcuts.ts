import { Schema } from '@shared/schema'
import { isExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { EXTENSION_PANEL_SHORTCUT_LIMITS, SHORTCUT_RULE_LIMITS } from '@shared/types/shortcuts'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'

export const shortcutBindingSchema = Schema.Struct({
  key: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(SHORTCUT_RULE_LIMITS.KEY_LENGTH),
    Schema.filter((key) => key.trim().length > 0),
  ),
  mod: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
})

export const shortcutWhenSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SHORTCUT_RULE_LIMITS.WHEN_LENGTH),
  Schema.filter((when) => parseProjectActionWhenExpression(when.trim()) !== null),
)

/**
 * Keys are checked by the record filter rather than a key refinement: Effect drops keys that fail
 * an index-signature refinement, which would silently discard a saved binding instead of failing.
 */
export const extensionPanelShortcutBindingsSchema = Schema.Record({
  key: Schema.String,
  value: shortcutBindingSchema,
}).pipe(
  Schema.filter((bindings) => Object.keys(bindings).every(isExtensionRightPanelSurfaceId), {
    message: () => 'Extension panel shortcuts must be keyed by an extension panel surface id.',
  }),
  Schema.filter(
    (bindings) => Object.keys(bindings).length <= EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS,
    {
      message: () =>
        `At most ${String(EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS)} extension panel shortcuts are allowed.`,
    },
  ),
)
