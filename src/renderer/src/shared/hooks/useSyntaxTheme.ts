import { bundledShikiTheme, type SyntaxAppearanceVariant } from '@shared/types/syntax'
import { useSyntaxThemeRuntimeStore } from '@/shared/lib/syntax/syntax-theme-runtime'
import { useAppearanceName } from './useAppearanceName'

export function syntaxAppearanceVariant(appearance: string): SyntaxAppearanceVariant {
  if (appearance === 'light') return 'light'
  if (appearance === 'high-contrast-light') return 'high-contrast-light'
  if (appearance === 'high-contrast-dark') return 'high-contrast-dark'
  return 'dark'
}

export function useSyntaxTheme() {
  const appearance = useAppearanceName()
  const selections = useSyntaxThemeRuntimeStore((state) => state.selections)
  const resources = useSyntaxThemeRuntimeStore((state) => state.resources)
  const variant = syntaxAppearanceVariant(appearance)
  const themeId = selections[variant]
  const importedTheme = resources.find((resource) => resource.id === themeId)
  return {
    variant,
    themeId,
    shikiTheme: importedTheme?.theme.name ?? bundledShikiTheme(themeId),
  }
}
