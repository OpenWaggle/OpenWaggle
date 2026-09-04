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

interface SyntaxLanguageClaim {
  readonly label: string
  readonly scope: SyntaxLanguageResource['scope']
}

export interface SyntaxLanguageResourceActivation {
  readonly resource: SyntaxLanguageResource
  readonly disabledReason: string | null
}

const BUNDLED_FILE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION))
const BUNDLED_FILE_NAMES = new Set(Object.keys(BASENAME_LANGUAGES))

function bundledLanguageClaims() {
  const claims = new Map<string, SyntaxLanguageClaim>()
  for (const language of bundledLanguagesInfo) {
    const claim = { label: language.name, scope: 'bundled' } satisfies SyntaxLanguageClaim
    claims.set(language.id, claim)
    for (const alias of language.aliases ?? []) claims.set(alias, claim)
  }
  return claims
}

function bundledExtensionClaims(): Map<string, SyntaxLanguageClaim> {
  return new Map<string, SyntaxLanguageClaim>(
    [...BUNDLED_FILE_EXTENSIONS].map((extension) => [
      extension,
      {
        label: LANGUAGE_BY_EXTENSION[extension] ?? 'built-in language',
        scope: 'bundled',
      } satisfies SyntaxLanguageClaim,
    ]),
  )
}

function bundledFileNameClaims(): Map<string, SyntaxLanguageClaim> {
  return new Map<string, SyntaxLanguageClaim>(
    [...BUNDLED_FILE_NAMES].map((fileName) => [
      fileName,
      {
        label: BASENAME_LANGUAGES[fileName] ?? 'built-in language',
        scope: 'bundled',
      } satisfies SyntaxLanguageClaim,
    ]),
  )
}

function collisionDiagnostic(
  kind: 'language identity or alias' | 'file extension' | 'filename',
  value: string,
  claim: SyntaxLanguageClaim,
) {
  return `Disabled because ${kind} "${value}" conflicts with ${claim.scope} grammar "${claim.label}".`
}

function collisionDiagnosticFor(
  kind: 'language identity or alias' | 'file extension' | 'filename',
  values: readonly string[],
  claims: ReadonlyMap<string, SyntaxLanguageClaim>,
) {
  for (const value of values) {
    const claim = claims.get(value)
    if (claim) return collisionDiagnostic(kind, value, claim)
  }
  return null
}

export function syntaxLanguageResourceActivations(
  resources: readonly SyntaxLanguageResource[],
): readonly SyntaxLanguageResourceActivation[] {
  const claimedIdentities = bundledLanguageClaims()
  const claimedExtensions = bundledExtensionClaims()
  const claimedFileNames = bundledFileNameClaims()
  const activations: SyntaxLanguageResourceActivation[] = []
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
    const disabledReason =
      resource.scope === 'project'
        ? (collisionDiagnosticFor('language identity or alias', identities, claimedIdentities) ??
          collisionDiagnosticFor('file extension', extensions, claimedExtensions) ??
          collisionDiagnosticFor('filename', fileNames, claimedFileNames))
        : null
    activations.push({ resource, disabledReason })
    if (disabledReason) continue

    const claim = { label: resource.label, scope: resource.scope } satisfies SyntaxLanguageClaim
    for (const identity of identities) claimedIdentities.set(identity, claim)
    for (const extension of extensions) claimedExtensions.set(extension, claim)
    for (const fileName of fileNames) claimedFileNames.set(fileName, claim)
  }
  return activations
}

/** Project grammars may add languages, but an untrusted checkout cannot silently
 * replace the bundled/user grammar used for a familiar language or file type. */
export function activatableSyntaxLanguageResources(resources: readonly SyntaxLanguageResource[]) {
  return syntaxLanguageResourceActivations(resources).flatMap(({ resource, disabledReason }) =>
    disabledReason ? [] : [resource],
  )
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
