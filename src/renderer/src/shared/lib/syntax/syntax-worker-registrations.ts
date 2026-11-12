import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import type { HighlighterCore, LanguageRegistration } from 'shiki'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLanguageRegistration(value: unknown): value is LanguageRegistration {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.scopeName === 'string' &&
    Array.isArray(value.patterns) &&
    isRecord(value.repository)
  )
}

export function importedLanguageRegistration(
  resource: SyntaxLanguageResource,
): LanguageRegistration {
  const candidate: unknown = {
    ...resource.registration.grammar,
    name: resource.registration.name,
    displayName: resource.registration.displayName,
    scopeName: resource.registration.scopeName,
    aliases: [...resource.registration.aliases],
    fileTypes: resource.registration.fileExtensions.map((extension) =>
      extension.replace(/^\./u, ''),
    ),
    embeddedLangs: [...new Set(Object.values(resource.registration.embeddedLanguages))],
    injectTo: [...resource.registration.injectTo],
  }
  if (!isLanguageRegistration(candidate)) {
    throw new Error(`Invalid imported grammar: ${resource.languageId}`)
  }
  return candidate
}

function mutableScope(scope: string | readonly string[]): string | string[] {
  return typeof scope === 'string' ? scope : [...scope]
}

export async function loadImportedTheme(
  instance: HighlighterCore,
  imported: SyntaxThemeRegistration,
) {
  if (instance.getLoadedThemes().includes(imported.name)) return
  await instance.loadTheme({
    name: imported.name,
    displayName: imported.displayName,
    type: imported.type,
    colors: { ...imported.colors },
    settings: imported.settings.map((rule) => ({
      ...(rule.name ? { name: rule.name } : {}),
      ...(rule.scope ? { scope: mutableScope(rule.scope) } : {}),
      settings: { ...rule.settings },
    })),
  })
}
