import { Schema } from '@shared/schema'
import { isExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  EXTENSION_PANEL_SHORTCUT_LIMITS,
  SHORTCUT_COMMANDS,
  SHORTCUT_RULE_LIMITS,
} from '@shared/types/shortcuts'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'

/** The single source of the shortcut setting types in `@shared/types/shortcut-contract`. */

export const shortcutCommandSchema = Schema.Literal(...SHORTCUT_COMMANDS)

export const shortcutBindingSchema = Schema.Struct({
  key: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(SHORTCUT_RULE_LIMITS.KEY_LENGTH),
    Schema.filter((key) => key.trim().length > 0),
  ),
  mod: Schema.optionalWith(Schema.Boolean, { exact: true }),
  ctrl: Schema.optionalWith(Schema.Boolean, { exact: true }),
  shift: Schema.optionalWith(Schema.Boolean, { exact: true }),
  alt: Schema.optionalWith(Schema.Boolean, { exact: true }),
  meta: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

export const shortcutWhenSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SHORTCUT_RULE_LIMITS.WHEN_LENGTH),
  Schema.filter((when) => parseProjectActionWhenExpression(when.trim()) !== null),
)

/** One ordered built-in command rule. Later active rules win globally. */
export const shortcutRuleSchema = Schema.Struct({
  command: shortcutCommandSchema,
  shortcut: shortcutBindingSchema,
  when: Schema.optionalWith(shortcutWhenSchema, { exact: true }),
})

export const shortcutRulesSchema = Schema.Array(shortcutRuleSchema).pipe(
  Schema.maxItems(SHORTCUT_RULE_LIMITS.RULES),
)

/** One representative binding per command; `null` leaves the command unassigned. */
export const shortcutBindingsSchema = Schema.Record({
  key: shortcutCommandSchema,
  value: Schema.NullOr(shortcutBindingSchema),
})

/**
 * User bindings for extension side panels, keyed by the stable extension Right panel surface id
 * (`extensionRightPanelSurfaceId`). An absent key is unassigned; extensions cannot declare
 * defaults, and a binding outlives its extension so a reinstall gets it back (ADR 0043).
 *
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
