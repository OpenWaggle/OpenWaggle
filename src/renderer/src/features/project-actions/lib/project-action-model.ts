import {
  PROJECT_ACTION_LIMITS,
  type ProjectAction,
  type ProjectActionIcon,
  type ProjectActionInput,
  type ProjectActionShortcutRule,
} from '@shared/types/project-actions'
import {
  RESERVED_SHORTCUT_KEYS,
  SHORTCUT_DEFINITIONS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutRules,
  shortcutBindingKey,
  shortcutRulesFromBindings,
} from '@shared/types/shortcuts'
import {
  orderedProjectActionShortcuts,
  parseProjectActionWhenExpression,
  projectActionShortcutRules,
  projectActionWhenIdentifiers,
} from '@shared/utils/project-action-shortcuts'
import { normalizeBrowserPreviewUrl } from '@/features/browser-preview'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

export const PROJECT_ACTION_WHEN_VARIABLES = [
  'terminalFocus',
  'terminalOpen',
  'previewFocus',
  'previewOpen',
  'modelPickerOpen',
  'true',
  'false',
] as const

const PROJECT_ACTION_WHEN_VARIABLE_SET = new Set<string>(PROJECT_ACTION_WHEN_VARIABLES)

export interface ProjectActionShortcutRuleDraft {
  readonly draftKey: string
  readonly shortcut: ShortcutBinding | null
  readonly when: string
  readonly order: number | null
}

export interface ProjectActionDraft {
  readonly name: string
  readonly command: string
  readonly icon: ProjectActionIcon
  readonly runOnWorktreeCreate: boolean
  readonly previewUrl: string
  readonly autoOpenPreview: boolean
  readonly shortcutRules: readonly ProjectActionShortcutRuleDraft[]
}

export function emptyProjectActionShortcutRuleDraft(
  draftKey = 'new-binding-0',
): ProjectActionShortcutRuleDraft {
  return {
    draftKey,
    shortcut: null,
    when: '',
    order: null,
  }
}

const EMPTY_PROJECT_ACTION_SHORTCUT_RULE: ProjectActionShortcutRuleDraft = {
  draftKey: 'empty-binding',
  shortcut: null,
  when: '',
  order: null,
}

export const EMPTY_PROJECT_ACTION_DRAFT: ProjectActionDraft = {
  name: '',
  command: '',
  icon: 'play',
  runOnWorktreeCreate: false,
  previewUrl: '',
  autoOpenPreview: false,
  shortcutRules: [EMPTY_PROJECT_ACTION_SHORTCUT_RULE],
}

export function projectActionDraft(action: ProjectAction | null): ProjectActionDraft {
  if (action === null) return EMPTY_PROJECT_ACTION_DRAFT
  const shortcutRules = projectActionShortcutRules(action).map((rule, index) => ({
    draftKey: `${action.id}-binding-${String(index)}`,
    shortcut: rule.shortcut,
    when: rule.when ?? '',
    order: rule.order ?? null,
  }))
  return {
    name: action.name,
    command: action.command,
    icon: action.icon,
    runOnWorktreeCreate: action.runOnWorktreeCreate,
    previewUrl: action.previewUrl ?? '',
    autoOpenPreview: action.autoOpenPreview ?? false,
    shortcutRules:
      shortcutRules.length > 0
        ? shortcutRules
        : [emptyProjectActionShortcutRuleDraft(`${action.id}-binding-empty`)],
  }
}

export function primaryProjectAction(
  actions: readonly ProjectAction[],
  lastInvokedId: string | null,
) {
  const remembered = actions.find((action) => action.id === lastInvokedId)
  return remembered ?? actions.find((action) => !action.runOnWorktreeCreate) ?? actions[0] ?? null
}

export type ProjectActionDraftValidation =
  | { readonly ok: true; readonly input: ProjectActionInput }
  | { readonly ok: false; readonly error: string }

type ShortcutRulesValidation =
  | { readonly ok: true; readonly rules: readonly ProjectActionShortcutRule[] }
  | { readonly ok: false; readonly error: string }

function validateShortcutRules(
  rules: readonly ProjectActionShortcutRuleDraft[],
): ShortcutRulesValidation {
  if (rules.length > PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT) {
    return {
      ok: false,
      error: `An action may have at most ${String(PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT)} bindings.`,
    }
  }
  const shortcutRules: ProjectActionShortcutRule[] = []
  for (const [index, rule] of rules.entries()) {
    const when = rule.when.trim()
    if (rule.shortcut === null) {
      if (when.length > 0) {
        return {
          ok: false,
          error: `Binding ${String(index + 1)} needs a shortcut or an empty condition.`,
        }
      }
      continue
    }
    if (when.length > PROJECT_ACTION_LIMITS.SHORTCUT_WHEN_LENGTH) {
      return {
        ok: false,
        error: `Binding ${String(index + 1)} condition is too long.`,
      }
    }
    if (when.length > 0 && parseProjectActionWhenExpression(when) === null) {
      return {
        ok: false,
        error: `Binding ${String(index + 1)} condition must use variables with !, &&, ||, and parentheses.`,
      }
    }
    shortcutRules.push({
      shortcut: rule.shortcut,
      ...(when.length > 0 ? { when } : {}),
      ...(rule.order === null ? {} : { order: rule.order }),
    })
  }
  return { ok: true, rules: shortcutRules }
}

export function validateProjectActionDraft(
  draft: ProjectActionDraft,
): ProjectActionDraftValidation {
  const name = draft.name.trim()
  const command = draft.command.trim()
  const previewUrl = draft.previewUrl.trim()
  if (name.length === 0) return { ok: false, error: 'Name is required.' }
  if (command.length === 0) return { ok: false, error: 'Command is required.' }
  const normalizedPreview = previewUrl.length === 0 ? null : normalizeBrowserPreviewUrl(previewUrl)
  if (previewUrl.length > 0 && normalizedPreview === null) {
    return { ok: false, error: 'Preview URL must be a valid http or https address.' }
  }
  const shortcutRules = validateShortcutRules(draft.shortcutRules)
  if (!shortcutRules.ok) return shortcutRules
  return {
    ok: true,
    input: {
      name,
      command,
      icon: draft.icon,
      runOnWorktreeCreate: draft.runOnWorktreeCreate,
      previewUrl: normalizedPreview,
      autoOpenPreview: normalizedPreview !== null && draft.autoOpenPreview,
      shortcutRules: shortcutRules.rules,
    },
  }
}

export interface ShortcutEventLike {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

function normalizedShortcutKey(key: string) {
  if (key === ' ') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

function shortcutModifiers(event: ShortcutEventLike, applePlatform: boolean) {
  return {
    ...((applePlatform ? event.metaKey : event.ctrlKey) ? { mod: true } : {}),
    ...(applePlatform && event.ctrlKey ? { ctrl: true } : {}),
    ...(!applePlatform && event.metaKey ? { meta: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
  }
}

export function projectActionBindingFromEvent(
  event: ShortcutEventLike,
  applePlatform: boolean,
): ShortcutBinding | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const binding: ShortcutBinding = {
    key: normalizedShortcutKey(event.key),
    ...shortcutModifiers(event, applePlatform),
  }
  return binding.mod || binding.ctrl || binding.alt || binding.shift || binding.meta
    ? binding
    : null
}

function conditionsMayConflict(left: string, right: string) {
  return left.length === 0 || right.length === 0 || left === right
}

export type BuiltInShortcutSource = ShortcutBindings | ShortcutRules

function isShortcutRules(source: BuiltInShortcutSource): source is ShortcutRules {
  return Array.isArray(source)
}

function normalizedBuiltInRules(source: BuiltInShortcutSource) {
  return isShortcutRules(source) ? source : shortcutRulesFromBindings(source)
}

export function projectActionShortcutRulesMayConflict(
  left: ProjectActionShortcutRule,
  right: ProjectActionShortcutRule,
) {
  return (
    shortcutBindingKey(left.shortcut) === shortcutBindingKey(right.shortcut) &&
    conditionsMayConflict(left.when?.trim() ?? '', right.when?.trim() ?? '')
  )
}

/** Matches T3's settings warning rule; runtime precedence remains deterministic even on overlap. */
export function projectActionShortcutConflictLabels(
  actionId: string,
  ruleIndex: number,
  rule: ProjectActionShortcutRule,
  actions: readonly ProjectAction[],
  builtInBindings: BuiltInShortcutSource,
) {
  const key = shortcutBindingKey(rule.shortcut)
  const when = rule.when?.trim() ?? ''
  const labels: string[] = []
  const reserved = RESERVED_SHORTCUT_KEYS[key]
  if (reserved !== undefined) labels.push(reserved)

  for (const builtInRule of normalizedBuiltInRules(builtInBindings)) {
    const definition = SHORTCUT_DEFINITIONS.find(
      (candidate) => candidate.command === builtInRule.command,
    )
    if (
      definition !== undefined &&
      shortcutBindingKey(builtInRule.shortcut) === key &&
      conditionsMayConflict(builtInRule.when?.trim() ?? '', when)
    ) {
      labels.push(definition.label)
    }
  }

  for (const entry of orderedProjectActionShortcuts(actions)) {
    if (entry.action.id === actionId && entry.ruleIndex === ruleIndex) continue
    if (projectActionShortcutRulesMayConflict(rule, entry.rule)) {
      labels.push(entry.action.name)
    }
  }
  return [...new Set(labels)].sort()
}

export function projectActionHasShortcutConflicts(
  action: ProjectAction,
  actions: readonly ProjectAction[],
  builtInBindings: BuiltInShortcutSource,
) {
  return projectActionShortcutRules(action).some(
    (rule, ruleIndex) =>
      projectActionShortcutConflictLabels(action.id, ruleIndex, rule, actions, builtInBindings)
        .length > 0,
  )
}

export function projectActionShortcutSummary(action: ProjectAction) {
  const entries = orderedProjectActionShortcuts([action])
  const latest = entries.at(-1)?.rule ?? null
  return { latest, count: entries.length }
}

export function projectActionUnknownWhenVariables(when: string) {
  const identifiers = projectActionWhenIdentifiers(when.trim())
  if (identifiers === null) return []
  return identifiers
    .filter((identifier) => !PROJECT_ACTION_WHEN_VARIABLE_SET.has(identifier))
    .sort()
}
