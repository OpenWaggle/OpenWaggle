import type { Settings } from '@shared/types/settings'
import { shortcutRulesFromBindings, shortcutRulesWithDefaults } from '@shared/types/shortcuts'
import { sanitizeShortcutBindings, sanitizeShortcutRules } from './sanitizers'

export function resolveNextShortcutRules(current: Settings, partial: Partial<Settings>) {
  if (partial.shortcutRules !== undefined) {
    return shortcutRulesWithDefaults(
      sanitizeShortcutRules(partial.shortcutRules) ?? current.shortcutRules,
    )
  }
  if (partial.shortcutBindings === undefined) return current.shortcutRules
  return shortcutRulesWithDefaults(
    shortcutRulesFromBindings(sanitizeShortcutBindings(partial.shortcutBindings)),
  )
}
