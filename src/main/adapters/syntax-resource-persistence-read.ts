import fs from 'node:fs/promises'
import path from 'node:path'
import { isMatching, P } from '@diegogbrisa/ts-match'
import { isSyntaxLanguageConfiguration } from '@shared/syntax-language-configuration'
import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { isRecord } from './syntax-resource-import-utils'

export const INSTALLED_RESOURCE_FILE_LIMIT = 20
export const INSTALLED_RESOURCE_CATALOG_MAX_BYTES = 8 * 1024 * 1024

export interface InstalledResourceReadBudget {
  remainingBytes: number
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

const syntaxResourceScopePattern = P.union('bundled', 'user', 'project')
const syntaxImportFormatPattern = P.union(
  'vscode-json',
  'textmate-plist',
  'vscode-vsix',
  'vscode-extension',
  'openwaggle',
)
const syntaxAppearanceVariantPattern = P.union(
  'light',
  'dark',
  'high-contrast-light',
  'high-contrast-dark',
)
const syntaxThemeTokenSettingsPattern = {
  foreground: P.optional(P.string),
  background: P.optional(P.string),
  fontStyle: P.optional(P.string),
}
const syntaxThemeTokenRulePattern = {
  name: P.optional(P.string),
  scope: P.optional(P.union(P.string, P.array(P.string))),
  settings: syntaxThemeTokenSettingsPattern,
}
const syntaxThemeRegistrationPattern = {
  name: P.string,
  displayName: P.string,
  type: P.union('light', 'dark'),
  colors: P.record(P.string, P.string),
  settings: P.array(syntaxThemeTokenRulePattern),
}

export function isSyntaxThemeResource(value: unknown): value is SyntaxThemeResource {
  return isMatching(
    {
      id: P.string,
      packageId: P.string,
      revision: P.string,
      label: P.string,
      variant: syntaxAppearanceVariantPattern,
      scope: syntaxResourceScopePattern,
      format: syntaxImportFormatPattern,
      sourcePath: P.string,
      theme: syntaxThemeRegistrationPattern,
      original: P.record(P.string, P._),
    },
    value,
  )
}

function hasPersistedResourceIdentity(value: Readonly<Record<string, unknown>>) {
  return (
    typeof value.id === 'string' &&
    typeof value.packageId === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.label === 'string' &&
    isMatching(syntaxResourceScopePattern, value.scope) &&
    isMatching(syntaxImportFormatPattern, value.format) &&
    typeof value.sourcePath === 'string' &&
    isRecord(value.original)
  )
}

function isStringList(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isPersistedLanguageRegistration(value: unknown) {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.scopeName === 'string' &&
    isStringList(value.aliases) &&
    isStringList(value.fileExtensions) &&
    isStringList(value.fileNames) &&
    isRecord(value.embeddedLanguages) &&
    Object.values(value.embeddedLanguages).every((entry) => typeof entry === 'string') &&
    isStringList(value.injectTo) &&
    isRecord(value.grammar) &&
    (value.configuration === undefined || isSyntaxLanguageConfiguration(value.configuration))
  )
}

export function isSyntaxLanguageResource(value: unknown): value is SyntaxLanguageResource {
  return (
    isRecord(value) &&
    hasPersistedResourceIdentity(value) &&
    typeof value.languageId === 'string' &&
    (value.engine === 'javascript' || value.engine === 'oniguruma') &&
    isPersistedLanguageRegistration(value.registration)
  )
}

export function isSyntaxAppearanceResource(value: unknown): value is SyntaxAppearanceResource {
  return (
    isRecord(value) &&
    hasPersistedResourceIdentity(value) &&
    value.format === 'openwaggle' &&
    isMatching(syntaxAppearanceVariantPattern, value.variant) &&
    isRecord(value.tokens) &&
    isRecord(value.original)
  )
}

export async function readPersistedResources<T>(
  directory: string,
  guard: (value: unknown) => value is T,
  budget: InstalledResourceReadBudget = {
    remainingBytes: INSTALLED_RESOURCE_CATALOG_MAX_BYTES,
  },
) {
  let names: string[]
  try {
    names = await fs.readdir(directory)
  } catch (error) {
    if (isMissingFileError(error)) return []
    throw error
  }
  const resourceNames = names.filter((entry) => entry.endsWith('.json'))
  if (resourceNames.length > INSTALLED_RESOURCE_FILE_LIMIT) {
    throw new Error('The installed syntax resource library exceeds its supported limit.')
  }
  const resources: T[] = []
  for (const name of resourceNames) {
    const resourcePath = path.join(directory, name)
    let size: number
    try {
      size = (await fs.stat(resourcePath)).size
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw error
    }
    if (size > budget.remainingBytes) {
      throw new Error('The installed syntax resource catalog exceeds its aggregate byte limit.')
    }
    budget.remainingBytes -= size
    let source: string
    try {
      source = await fs.readFile(resourcePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) continue
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      // One malformed user resource does not hide the rest of the library.
      continue
    }
    if (guard(parsed)) resources.push(parsed)
  }
  return resources
}
