import type {
  OpenWaggleExtensionSyntaxHighlightInput,
  OpenWaggleExtensionSyntaxHighlightResult,
  OpenWaggleExtensionSyntaxSdk,
} from '@shared/extension-sdk'
import { bundledShikiTheme } from '@shared/types/syntax'
import { usePreferencesStore } from '@/features/settings/state'
import { syntaxAppearanceVariant } from '@/shared/hooks/useSyntaxTheme'
import { languageFromPath, resolveSyntaxLanguage } from '@/shared/lib/syntax/language-registry'
import { syntaxService } from '@/shared/lib/syntax/syntax-service'
import { importedSyntaxThemeResource } from '@/shared/lib/syntax/theme-registry'

function currentSyntaxTheme() {
  const appearance = document.documentElement.getAttribute('data-theme') ?? 'dark'
  const variant = syntaxAppearanceVariant(appearance)
  const themeId = usePreferencesStore.getState().settings.syntaxThemeSelections[variant]
  return importedSyntaxThemeResource(themeId)?.theme.name ?? bundledShikiTheme(themeId)
}

function inputLanguage(input: OpenWaggleExtensionSyntaxHighlightInput) {
  if (input.language) return resolveSyntaxLanguage(input.language)
  if (input.path) return languageFromPath(input.path)
  return 'text'
}

export async function highlightExtensionSyntax(
  input: OpenWaggleExtensionSyntaxHighlightInput,
): Promise<OpenWaggleExtensionSyntaxHighlightResult> {
  const language = inputLanguage(input)
  const result = await syntaxService.highlight({
    source: input.source,
    language,
    theme: currentSyntaxTheme(),
    priority: input.priority ?? 'visible',
  })
  return {
    status: result.status,
    language: result.language,
    lines: result.lines,
    ...(result.foreground ? { foreground: result.foreground } : {}),
    ...(result.background ? { background: result.background } : {}),
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
  }
}

export function createRendererExtensionSyntaxSdk(): OpenWaggleExtensionSyntaxSdk {
  return { highlight: highlightExtensionSyntax }
}
