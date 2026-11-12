import { BASE_TEN, PERCENT_BASE } from '@shared/constants/math'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { lenientStringRecordSchema } from '@shared/schemas/lenient'
import { lenientWithFallback } from '@shared/schemas/lenient-exact'
import { settingsWireFields } from '@shared/schemas/settings-fields'
import {
  shortcutBindingSchema,
  shortcutCommandSchema,
  shortcutWhenSchema,
} from '@shared/schemas/settings-shortcuts'
import { Option } from 'effect'
import { SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import { DEFAULT_COMPACTION_THRESHOLD_PERCENT, DEFAULT_SETTINGS } from '@shared/types/settings'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  SHORTCUT_RULE_LIMITS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  type ShortcutRules,
  shortcutBindingKey,
  shortcutScopesOverlap,
} from '@shared/types/shortcuts'
import {
  DEFAULT_SYNTAX_THEME_SELECTIONS,
  type SyntaxAppearanceVariant,
  type SyntaxThemeSelections,
} from '@shared/types/syntax'
import { dropAddedDefaultsTakenByTheUser } from './shortcut-binding-defaults'

export function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const fields = settingsWireFields

/** A stored value when it decodes with the setting's own schema, else that setting's default. */
function storedOr<A, I>(schema: Schema.Schema<A, I>, fallback: NoInfer<A>) {
  const decode = Schema.decodeUnknownOption(schema)
  return (raw: unknown): A => Option.getOrElse(decode(raw), () => fallback)
}

export function resolveProjectPath(raw: unknown) {
  return storedOr(fields.projectPath, DEFAULT_SETTINGS.projectPath)(raw)
}

export const isValidSessionEnvironmentMode = Schema.is(fields.defaultSessionEnvironmentMode)

export const resolveDefaultSessionEnvironmentMode = storedOr(
  fields.defaultSessionEnvironmentMode,
  DEFAULT_SETTINGS.defaultSessionEnvironmentMode,
)

export const resolveDefaultAuthorizationMode = storedOr(
  fields.defaultAuthorizationMode,
  DEFAULT_SETTINGS.defaultAuthorizationMode,
)

export const isValidDiffSyntaxTheme = Schema.is(fields.diffSyntaxTheme)

export const resolveDiffSyntaxTheme = storedOr(
  fields.diffSyntaxTheme,
  DEFAULT_SETTINGS.diffSyntaxTheme,
)

const MAX_SYNTAX_THEME_ID_LENGTH = 240

/** A theme id is kept trimmed; a blank or overlong one leaves that variant at its default. */
const syntaxThemeIdSchema = Schema.Trim.pipe(
  Schema.minLength(1),
  Schema.filter((value) => value.length <= MAX_SYNTAX_THEME_ID_LENGTH),
)

function syntaxThemeId(variant: SyntaxAppearanceVariant) {
  return lenientWithFallback(syntaxThemeIdSchema, () => DEFAULT_SYNTAX_THEME_SELECTIONS[variant])
}

const decodeStoredSyntaxThemeSelections = Schema.decodeUnknownOption(
  Schema.Struct({
    light: syntaxThemeId('light'),
    dark: syntaxThemeId('dark'),
    'high-contrast-light': syntaxThemeId('high-contrast-light'),
    'high-contrast-dark': syntaxThemeId('high-contrast-dark'),
  }),
)

export function resolveSyntaxThemeSelections(raw: unknown): SyntaxThemeSelections {
  if (!isObjectRecord(raw)) return DEFAULT_SYNTAX_THEME_SELECTIONS
  return Option.getOrElse(
    decodeStoredSyntaxThemeSelections(raw),
    () => DEFAULT_SYNTAX_THEME_SELECTIONS,
  )
}

export const isValidDiffView = Schema.is(fields.diffView)

export const resolveDiffView = storedOr(fields.diffView, DEFAULT_SETTINGS.diffView)

/** Persisted as a string by the key-value store before it held JSON values. */
const storedBooleanSchema = Schema.Union(
  Schema.Boolean,
  Schema.transform(Schema.Literal('true', 'false'), Schema.Boolean, {
    strict: true,
    decode: (value) => value === 'true',
    encode: (value) => (value ? 'true' : 'false'),
  }),
)

export const resolveDiffWrapLines = storedOr(storedBooleanSchema, DEFAULT_SETTINGS.diffWrapLines)

export const resolveBrowserLinkTarget = storedOr(
  fields.browserLinkTarget,
  DEFAULT_SETTINGS.browserLinkTarget,
)

export const resolveCompactionThresholdPercent = storedOr(
  fields.compactionThresholdPercent,
  DEFAULT_COMPACTION_THRESHOLD_PERCENT,
)

export function normalizeStoredModelRef(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  if (parseModelRef(trimmed)) {
    return SupportedModelId(trimmed)
  }

  return null
}

export function sanitizeEnabledModels(models: readonly string[]) {
  const seen = new Set<string>()
  const result: SupportedModelId[] = []
  for (const model of models) {
    const normalized = normalizeStoredModelRef(model)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function resolveEnabledModels(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeEnabledModels(raw)
    : [...DEFAULT_SETTINGS.enabledModels]
}

export function resolveSelectedModel(raw: unknown, enabledModels: readonly SupportedModelId[]) {
  if (typeof raw !== 'string') {
    return DEFAULT_SETTINGS.selectedModel
  }

  const normalizedModel = raw.trim()
  if (!normalizedModel) {
    return DEFAULT_SETTINGS.selectedModel
  }

  if (parseModelRef(normalizedModel)) {
    const model = SupportedModelId(normalizedModel)
    return enabledModels.includes(model) ? model : DEFAULT_SETTINGS.selectedModel
  }

  return DEFAULT_SETTINGS.selectedModel
}

export function sanitizeFavoriteModels(models: readonly string[]) {
  const seen = new Set<string>()
  const result: SupportedModelId[] = []

  for (const model of models) {
    const normalized = normalizeStoredModelRef(model)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= PERCENT_BASE) break
  }

  return result
}

export function resolveFavoriteModels(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeFavoriteModels(raw)
    : [...DEFAULT_SETTINGS.favoriteModels]
}

export function sanitizeRecentProjects(paths: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const projectPath of paths) {
    const trimmed = projectPath.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= BASE_TEN) break
  }

  return result
}

export function resolveRecentProjects(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeRecentProjects(raw)
    : [...DEFAULT_SETTINGS.recentProjects]
}

export function sanitizeSkillTogglesByProject(value: Readonly<Record<string, unknown>>) {
  const sanitized: Record<string, Record<string, boolean>> = {}

  for (const [rawProjectPath, toggles] of Object.entries(value)) {
    const projectPath = rawProjectPath.trim()
    if (!projectPath || !isObjectRecord(toggles)) continue

    const nextToggles: Record<string, boolean> = {}
    for (const [rawSkillId, enabled] of Object.entries(toggles)) {
      const skillId = rawSkillId.trim()
      if (!skillId || typeof enabled !== 'boolean') continue
      nextToggles[skillId] = enabled
    }

    if (Object.keys(nextToggles).length > 0) {
      sanitized[projectPath] = nextToggles
    }
  }

  return sanitized
}

export function resolveSkillTogglesByProject(raw: unknown) {
  return isObjectRecord(raw)
    ? sanitizeSkillTogglesByProject(raw)
    : DEFAULT_SETTINGS.skillTogglesByProject
}

/** The string-valued entries of the stored display names; anything else is dropped. */
export function sanitizeProjectDisplayNames(raw: unknown) {
  return decodeUnknownOrThrow(lenientStringRecordSchema, raw)
}

/**
 * A stored binding: its key trimmed and within the limit, each modifier absent or a boolean. Only
 * the modifiers that are on are kept.
 */
export const storedShortcutBindingSchema = Schema.transform(
  Schema.Struct({
    ...shortcutBindingSchema.fields,
    key: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(SHORTCUT_RULE_LIMITS.KEY_LENGTH)),
  }),
  Schema.typeSchema(shortcutBindingSchema),
  {
    strict: true,
    decode: ({ key, mod, ctrl, shift, alt, meta }) => ({
      key,
      ...(mod === true ? { mod: true } : {}),
      ...(ctrl === true ? { ctrl: true } : {}),
      ...(shift === true ? { shift: true } : {}),
      ...(alt === true ? { alt: true } : {}),
      ...(meta === true ? { meta: true } : {}),
    }),
    encode: (binding) => binding,
  },
)

const decodeStoredShortcutBinding = Schema.decodeUnknownOption(storedShortcutBindingSchema)

export function sanitizeShortcutBinding(value: unknown): ShortcutBinding | null {
  return Option.getOrNull(decodeStoredShortcutBinding(value))
}

/** The canonical ordered rules; one malformed rule refuses the whole list. */
const decodeStoredShortcutRules = Schema.decodeUnknownOption(
  Schema.Array(
    Schema.Struct({
      command: shortcutCommandSchema,
      shortcut: storedShortcutBindingSchema,
      when: Schema.optionalWith(Schema.Trim.pipe(Schema.compose(shortcutWhenSchema)), {
        exact: true,
      }),
    }),
  ).pipe(Schema.maxItems(SHORTCUT_RULE_LIMITS.RULES)),
)

/** Validates the canonical ordered rule array without rejecting intentional overlaps. */
export function sanitizeShortcutRules(raw: unknown): ShortcutRules | null {
  return Option.getOrNull(decodeStoredShortcutRules(raw))
}

export function sanitizeShortcutBindings(raw: unknown): ShortcutBindings {
  if (!isObjectRecord(raw)) return DEFAULT_SHORTCUT_BINDINGS

  const result: Record<ShortcutCommand, ShortcutBinding | null> = {
    ...DEFAULT_SHORTCUT_BINDINGS,
  }
  for (const command of SHORTCUT_COMMANDS) {
    if (raw[command] === null && !isMandatoryShortcutCommand(command)) {
      result[command] = null
      continue
    }
    const binding = sanitizeShortcutBinding(raw[command])
    if (binding) result[command] = binding
  }
  dropAddedDefaultsTakenByTheUser(raw, result)
  const assigned = SHORTCUT_COMMANDS.flatMap((command) => {
    const binding = result[command]
    return binding === null ? [] : [{ binding, command }]
  })
  for (let leftIndex = 0; leftIndex < assigned.length; leftIndex += 1) {
    const left = assigned[leftIndex]
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < assigned.length; rightIndex += 1) {
      const right = assigned[rightIndex]
      if (!right) continue
      if (
        shortcutBindingKey(left.binding) === shortcutBindingKey(right.binding) &&
        shortcutScopesOverlap(left.command, right.command)
      ) {
        return DEFAULT_SHORTCUT_BINDINGS
      }
    }
  }
  return result
}
