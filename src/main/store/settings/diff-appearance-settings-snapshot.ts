import type { Settings } from '@shared/types/settings'
import { resolveAppearancePreferences } from './appearance-preferences-sanitizer'
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
