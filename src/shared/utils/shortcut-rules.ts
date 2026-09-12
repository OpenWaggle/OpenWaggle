import {
  SHORTCUT_RULE_LIMITS,
  type ShortcutCommand,
  type ShortcutRule,
  type ShortcutRules,
  shortcutRuleIdentity,
} from '@shared/types/shortcuts'
import {
  type ProjectActionShortcutContext,
  projectActionShortcutMatches,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'

export interface ShortcutRuleEvent {
  readonly key: string
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
}

/** Resolves one command across the global ordered list; later active matching rules win. */
export function resolveMatchingShortcutRule(
  event: ShortcutRuleEvent,
  rules: ShortcutRules,
  context: ProjectActionShortcutContext,
  applePlatform: boolean,
) {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (rule === undefined) continue
    if (!projectActionShortcutMatches(event, rule.shortcut, applePlatform)) continue
    if (projectActionWhenMatches(rule.when, context)) return { rule, index }
  }
  return null
}

/** Returns the newest active binding for labels and accessibility hints. */
export function activeShortcutRuleForCommand(
  rules: ShortcutRules,
  command: ShortcutCommand,
  context: ProjectActionShortcutContext,
  applePlatform = false,
) {
  const claimedShortcuts = new Set<string>()
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (rule === undefined || !projectActionWhenMatches(rule.when, context)) continue
    const primaryMeta = rule.shortcut.mod === true && applePlatform
    const primaryControl = rule.shortcut.mod === true && !applePlatform
    const conflictKey = [
      rule.shortcut.key.trim().toUpperCase(),
      rule.shortcut.meta === true || primaryMeta ? 'meta' : '',
      rule.shortcut.ctrl === true || primaryControl ? 'control' : '',
      rule.shortcut.alt === true ? 'alt' : '',
      rule.shortcut.shift === true ? 'shift' : '',
    ].join('|')
    if (claimedShortcuts.has(conflictKey)) continue
    claimedShortcuts.add(conflictKey)
    if (rule.command === command) return rule
  }
  return null
}

/** T3-compatible exact replacement: remove old/new duplicates and append newest. */
export function upsertShortcutRule(
  rules: ShortcutRules,
  next: ShortcutRule,
  replace?: ShortcutRule,
): ShortcutRules {
  const nextIdentity = shortcutRuleIdentity(next)
  const replaceIdentity = replace === undefined ? null : shortcutRuleIdentity(replace)
  return [
    ...rules.filter((rule) => {
      const identity = shortcutRuleIdentity(rule)
      return identity !== nextIdentity && identity !== replaceIdentity
    }),
    next,
  ].slice(-SHORTCUT_RULE_LIMITS.RULES)
}

/** Removes every exact duplicate of the selected persisted rule. */
export function removeShortcutRule(rules: ShortcutRules, target: ShortcutRule): ShortcutRules {
  const identity = shortcutRuleIdentity(target)
  return rules.filter((rule) => shortcutRuleIdentity(rule) !== identity)
}
