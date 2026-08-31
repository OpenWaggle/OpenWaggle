const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.bash': 'bash',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.mjs': 'javascript',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'bash',
  '.sql': 'sql',
  '.svelte': 'svelte',
  '.swift': 'swift',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zig': 'zig',
  '.zsh': 'bash',
}

const BASENAME_LANGUAGES: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cargo.toml': 'toml',
  'package.json': 'json',
  'tsconfig.json': 'jsonc',
}

let importedLanguages: readonly SyntaxLanguageResource[] = []
const EMPTY_ALIASES: readonly string[] = []
const USER_RESOURCE_SCOPE_RANK = 1
const BUNDLED_RESOURCE_SCOPE_RANK = 2

const BUNDLED_LANGUAGE_IDENTITIES = new Set(
  bundledLanguagesInfo.flatMap((language) => [language.id, ...(language.aliases ?? [])]),
)
const BUNDLED_FILE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION))
const BUNDLED_FILE_NAMES = new Set(Object.keys(BASENAME_LANGUAGES))

/** Project grammars may add languages, but an untrusted checkout cannot silently
 * replace the bundled/user grammar used for a familiar language or file type. */
export function activatableSyntaxLanguageResources(resources: readonly SyntaxLanguageResource[]) {
  const claimedIdentities = new Set(BUNDLED_LANGUAGE_IDENTITIES)
  const claimedExtensions = new Set(BUNDLED_FILE_EXTENSIONS)
  const claimedFileNames = new Set(BUNDLED_FILE_NAMES)
  const activated: SyntaxLanguageResource[] = []
  const ordered = [...resources].sort((left, right) => {
    if (left.scope === right.scope) return 0
    if (left.scope === 'project') return 1
    if (right.scope === 'project') return -1
    return 0
  })
  for (const resource of ordered) {
    const identities = [resource.languageId, ...resource.registration.aliases].map((value) =>
      value.toLowerCase(),
    )
    const extensions = resource.registration.fileExtensions.map((value) => value.toLowerCase())
    const fileNames = resource.registration.fileNames.map((value) => value.toLowerCase())
    if (
      resource.scope === 'project' &&
      (identities.some((value) => claimedIdentities.has(value)) ||
        extensions.some((value) => claimedExtensions.has(value)) ||
        fileNames.some((value) => claimedFileNames.has(value)))
    ) {
      continue
    }
    activated.push(resource)
    for (const identity of identities) claimedIdentities.add(identity)
    for (const extension of extensions) claimedExtensions.add(extension)
    for (const fileName of fileNames) claimedFileNames.add(fileName)
  }
  return activated
}

export function registerImportedSyntaxLanguageResources(
  resources: readonly SyntaxLanguageResource[],
) {
  importedLanguages = [...resources].sort((left, right) => {
    const scopeRank = (scope: SyntaxLanguageResource['scope']) =>
      scope === 'project'
        ? 0
        : scope === 'user'
          ? USER_RESOURCE_SCOPE_RANK
          : BUNDLED_RESOURCE_SCOPE_RANK
    return scopeRank(left.scope) - scopeRank(right.scope) || left.label.localeCompare(right.label)
  })
}

export function syntaxLanguageCatalog() {
  return [
    { id: 'text', name: 'Plain Text', aliases: EMPTY_ALIASES, provenance: 'bundled' },
    ...bundledLanguagesInfo.map((language) => ({
      id: language.id,
      name: language.name,
      aliases: language.aliases ?? [],
      provenance: 'bundled' as const,
    })),
    ...importedLanguages.map((resource) => ({
      id: resource.languageId,
      name: resource.label,
      aliases: resource.registration.aliases,
      provenance: resource.scope,
    })),
  ]
}

export function resolveSyntaxLanguage(
  value: string,
  availableImportedLanguages: readonly SyntaxLanguageResource[] = importedLanguages,
) {
  const normalized = value.trim().toLowerCase()
  const imported = availableImportedLanguages.find(
    (resource) =>
      resource.languageId.toLowerCase() === normalized ||
      resource.registration.aliases.some((alias) => alias.toLowerCase() === normalized),
  )
  if (imported) return imported.languageId
  const bundled = bundledLanguagesInfo.find(
    (language) =>
      language.id === normalized || language.aliases?.some((alias) => alias === normalized),
  )
  return bundled?.id ?? 'text'
}

export function languageFromPath(
  path: string,
  availableImportedLanguages: readonly SyntaxLanguageResource[] = importedLanguages,
) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const imported = availableImportedLanguages.find(
    (resource) =>
      resource.registration.fileNames.some((fileName) => fileName.toLowerCase() === basename) ||
      resource.registration.fileExtensions.some((extension) => basename.endsWith(extension)),
  )
  if (imported) return imported.languageId
  const exact = BASENAME_LANGUAGES[basename]
  if (exact) return exact
  const dot = basename.lastIndexOf('.')
  return dot < 0 ? 'text' : (LANGUAGE_BY_EXTENSION[basename.slice(dot)] ?? 'text')
}

import type { SyntaxLanguageResource } from '@shared/types/syntax-resources'
import { bundledLanguagesInfo } from 'shiki'
