import { registerCustomLanguage, registerCustomTheme } from '@pierre/diffs'
import { importedPierreSyntaxResources, pierreRuntimeLanguageName } from './pierre-syntax'
import { importedLanguageRegistration } from './syntax-worker-registrations'

const registeredRuntimeThemes = new Set<string>()
const registeredRuntimeLanguages = new Set<string>()
const runtimeLanguageByStableId = new Map<string, string>()

function mutableScope(scope: string | readonly string[]) {
  return typeof scope === 'string' ? scope : [...scope]
}

export function registerPendingPierreSyntaxResources() {
  const resources = importedPierreSyntaxResources()
  for (const resource of resources.themes) {
    const runtimeName = resource.theme.name
    if (registeredRuntimeThemes.has(runtimeName)) continue
    registerCustomTheme(runtimeName, async () => ({
      name: runtimeName,
      displayName: resource.theme.displayName,
      type: resource.theme.type,
      colors: { ...resource.theme.colors },
      settings: resource.theme.settings.map((rule) => ({
        ...(rule.name ? { name: rule.name } : {}),
        ...(rule.scope ? { scope: mutableScope(rule.scope) } : {}),
        settings: { ...rule.settings },
      })),
    }))
    registeredRuntimeThemes.add(runtimeName)
  }
  for (const resource of resources.languages) {
    const runtimeName = pierreRuntimeLanguageName(resource)
    runtimeLanguageByStableId.set(resource.languageId.toLowerCase(), runtimeName)
    for (const alias of resource.registration.aliases) {
      runtimeLanguageByStableId.set(alias.toLowerCase(), runtimeName)
    }
    if (registeredRuntimeLanguages.has(runtimeName)) continue
    registerCustomLanguage(runtimeName, async () => ({
      default: [
        {
          ...importedLanguageRegistration(resource),
          name: runtimeName,
          aliases: [runtimeName],
        },
      ],
    }))
    registeredRuntimeLanguages.add(runtimeName)
  }
}

export function pierreLanguageId(language: string) {
  registerPendingPierreSyntaxResources()
  return runtimeLanguageByStableId.get(language.toLowerCase()) ?? language
}
