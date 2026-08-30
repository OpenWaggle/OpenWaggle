import fs from 'node:fs/promises'
import path from 'node:path'
import { isSyntaxLanguageConfiguration } from '@shared/syntax-language-configuration'
import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { isRecord } from './syntax-resource-import-utils'

export const INSTALLED_RESOURCE_FILE_LIMIT = 20

export function isSyntaxThemeResource(value: unknown): value is SyntaxThemeResource {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.packageId === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.label === 'string' &&
    typeof value.sourcePath === 'string' &&
    isRecord(value.theme) &&
    isRecord(value.original)
  )
}

function hasPersistedResourceIdentity(value: Readonly<Record<string, unknown>>) {
  return (
    typeof value.id === 'string' &&
    typeof value.packageId === 'string' &&
    typeof value.revision === 'string' &&
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
    typeof value.id === 'string' &&
    typeof value.packageId === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.label === 'string' &&
    typeof value.sourcePath === 'string' &&
    value.format === 'openwaggle' &&
    (value.variant === 'light' ||
      value.variant === 'dark' ||
      value.variant === 'high-contrast-light' ||
      value.variant === 'high-contrast-dark') &&
    isRecord(value.tokens) &&
    isRecord(value.original)
  )
}

export async function readPersistedResources<T>(
  directory: string,
  guard: (value: unknown) => value is T,
) {
  let names: string[]
  try {
    names = await fs.readdir(directory)
  } catch {
    return []
  }
  const resourceNames = names.filter((entry) => entry.endsWith('.json'))
  if (resourceNames.length > INSTALLED_RESOURCE_FILE_LIMIT) {
    throw new Error('The installed syntax resource library exceeds its supported limit.')
  }
  const sources = await Promise.all(
    resourceNames.map(async (name): Promise<string | null> => {
      try {
        return await fs.readFile(path.join(directory, name), 'utf8')
      } catch {
        return null
      }
    }),
  )
  const resources: T[] = []
  for (const source of sources) {
    if (source === null) continue
    try {
      const parsed: unknown = JSON.parse(source)
      if (guard(parsed)) resources.push(parsed)
    } catch {
      // One malformed user resource does not hide the rest of the library.
    }
  }
  return resources
}
