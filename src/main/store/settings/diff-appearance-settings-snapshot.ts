import type { Settings } from '@shared/types/settings'
import { resolveAppearancePreferences } from './appearance-preferences-sanitizer'
import {
  SETTINGS_KEY_DIFF_SYNTAX_THEME,
  SETTINGS_KEY_DIFF_VIEW,
  SETTINGS_KEY_DIFF_WRAP_LINES,
  SETTINGS_KEY_SYNTAX_THEME_SELECTIONS,
} from './keys'
import type { SettingsPatchWrite } from './persistence-plan'
import { isValidDiffSyntaxTheme, isValidDiffView, resolveSyntaxThemeSelections } from './sanitizers'

/** Diff and appearance preferences, split out to keep buildNextSettingsSnapshot within complexity limits. */
export function resolveNextDiffAndAppearanceSettings(
  current: Settings,
  partial: Partial<Settings>,
) {
  return {
    diffSyntaxTheme:
      partial.diffSyntaxTheme !== undefined && isValidDiffSyntaxTheme(partial.diffSyntaxTheme)
        ? partial.diffSyntaxTheme
        : current.diffSyntaxTheme,
    syntaxThemeSelections:
      partial.syntaxThemeSelections !== undefined
        ? resolveSyntaxThemeSelections(partial.syntaxThemeSelections)
        : current.syntaxThemeSelections,
    diffView:
      partial.diffView !== undefined && isValidDiffView(partial.diffView)
        ? partial.diffView
        : current.diffView,
    diffWrapLines:
      typeof partial.diffWrapLines === 'boolean' ? partial.diffWrapLines : current.diffWrapLines,
    appearancePreferences:
      partial.appearancePreferences !== undefined
        ? resolveAppearancePreferences(partial.appearancePreferences)
        : current.appearancePreferences,
  }
}

export function appendDiffSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.diffSyntaxTheme !== undefined) {
    writes.push({ key: SETTINGS_KEY_DIFF_SYNTAX_THEME, value: next.diffSyntaxTheme })
  }
  if (partial.syntaxThemeSelections !== undefined) {
    writes.push({ key: SETTINGS_KEY_SYNTAX_THEME_SELECTIONS, value: next.syntaxThemeSelections })
  }
  if (partial.diffView !== undefined) {
    writes.push({ key: SETTINGS_KEY_DIFF_VIEW, value: next.diffView })
  }
  if (partial.diffWrapLines !== undefined) {
    writes.push({ key: SETTINGS_KEY_DIFF_WRAP_LINES, value: next.diffWrapLines })
  }
}
