import type { SyntaxLanguageResource, SyntaxThemeResource } from '@shared/types/syntax-resources'

let importedThemes: readonly SyntaxThemeResource[] = []
let importedLanguages: readonly SyntaxLanguageResource[] = []

export function pierreRuntimeLanguageName(resource: SyntaxLanguageResource) {
  return `openwaggle:${resource.languageId}:${resource.revision}`
}

export function setImportedPierreSyntaxResources(
  themes: readonly SyntaxThemeResource[],
  languages: readonly SyntaxLanguageResource[],
) {
  importedThemes = themes
  importedLanguages = languages
}

export function importedPierreSyntaxResources() {
  return { themes: importedThemes, languages: importedLanguages }
}
