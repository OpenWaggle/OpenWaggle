import { constants as fsConstants } from 'node:fs'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { isMatching, P } from '@diegogbrisa/ts-match'
import { Schema } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { isSyntaxLanguageConfiguration } from '@shared/syntax-language-configuration'
import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { createLogger } from '../logger'

export const INSTALLED_RESOURCE_FILE_LIMIT = 20
export const INSTALLED_RESOURCE_CATALOG_MAX_BYTES = 8 * 1024 * 1024
const logger = createLogger('syntax-resource-persistence')
const RESOURCE_READ_CHUNK_BYTES = 64 * 1024

export interface InstalledResourceReadBudget {
  remainingBytes: number
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isSymlinkOpenError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ELOOP'
}

function invalidResourceFileError(resourcePath: string, cause?: unknown) {
  return new Error(`Installed syntax resource must be a regular file: ${resourcePath}`, { cause })
}

async function readResourceWithinBudget(
  handle: FileHandle,
  resourcePath: string,
  budget: InstalledResourceReadBudget,
) {
  const metadata = await handle.stat()
  if (!metadata.isFile()) throw invalidResourceFileError(resourcePath)
  if (metadata.size > budget.remainingBytes) {
    throw new Error('The installed syntax resource catalog exceeds its aggregate byte limit.')
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  while (true) {
    const remainingWithOverflowByte = budget.remainingBytes - totalBytes + 1
    if (remainingWithOverflowByte <= 0) {
      throw new Error('The installed syntax resource catalog exceeds its aggregate byte limit.')
    }
    const chunk = Buffer.allocUnsafe(Math.min(RESOURCE_READ_CHUNK_BYTES, remainingWithOverflowByte))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) break
    totalBytes += bytesRead
    if (totalBytes > budget.remainingBytes) {
      throw new Error('The installed syntax resource catalog exceeds its aggregate byte limit.')
    }
    chunks.push(chunk.subarray(0, bytesRead))
  }
  budget.remainingBytes -= totalBytes
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}

async function readRegularResourceFile(resourcePath: string, budget: InstalledResourceReadBudget) {
  let metadata: Awaited<ReturnType<typeof fs.lstat>>
  try {
    metadata = await fs.lstat(resourcePath)
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
  if (!metadata.isFile()) throw invalidResourceFileError(resourcePath)

  let handle: FileHandle
  try {
    handle = await fs.open(resourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if (isMissingFileError(error)) return null
    if (isSymlinkOpenError(error)) throw invalidResourceFileError(resourcePath, error)
    throw error
  }
  try {
    return await readResourceWithinBudget(handle, resourcePath, budget)
  } finally {
    await handle.close()
  }
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

const persistedResourceIdentity = {
  id: Schema.String,
  packageId: Schema.String,
  revision: Schema.String,
  label: Schema.String,
  scope: Schema.Literal('bundled', 'user', 'project'),
  sourcePath: Schema.String,
  original: jsonObjectSchema,
}

const stringListSchema = Schema.Array(Schema.String)

const syntaxLanguageResourceSchema: Schema.Schema<SyntaxLanguageResource> = Schema.Struct({
  ...persistedResourceIdentity,
  format: Schema.Literal(
    'vscode-json',
    'textmate-plist',
    'vscode-vsix',
    'vscode-extension',
    'openwaggle',
  ),
  languageId: Schema.String,
  engine: Schema.Literal('javascript', 'oniguruma'),
  registration: Schema.Struct({
    name: Schema.String,
    displayName: Schema.String,
    scopeName: Schema.String,
    aliases: stringListSchema,
    fileExtensions: stringListSchema,
    fileNames: stringListSchema,
    embeddedLanguages: Schema.Record({ key: Schema.String, value: Schema.String }),
    injectTo: stringListSchema,
    grammar: jsonObjectSchema,
    configuration: Schema.optionalWith(
      Schema.declare((value) => isSyntaxLanguageConfiguration(value)),
      { exact: true },
    ),
  }),
})

const syntaxAppearanceResourceSchema: Schema.Schema<SyntaxAppearanceResource> = Schema.Struct({
  ...persistedResourceIdentity,
  format: Schema.Literal('openwaggle'),
  variant: Schema.Literal('light', 'dark', 'high-contrast-light', 'high-contrast-dark'),
  tokens: jsonObjectSchema,
})

export const isSyntaxLanguageResource = Schema.is(syntaxLanguageResourceSchema)

export const isSyntaxAppearanceResource = Schema.is(syntaxAppearanceResourceSchema)

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
    const source = await readRegularResourceFile(resourcePath, budget)
    if (source === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      // One malformed user resource does not hide the rest of the library.
      logger.warn('Ignored malformed installed syntax resource JSON', {
        resourcePath,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (guard(parsed)) {
      resources.push(parsed)
    } else {
      logger.warn('Ignored invalid installed syntax resource', { resourcePath })
    }
  }
  return resources
}
