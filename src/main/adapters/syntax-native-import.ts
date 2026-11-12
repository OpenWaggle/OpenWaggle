import { createHash } from 'node:crypto'
import path from 'node:path'
import { decodeUnknownOrThrow } from '@shared/schema'
import type { SyntaxAppearanceResource, SyntaxResourceScope } from '@shared/types/syntax-resources'
import { normalizedLanguage } from './syntax-language-normalization'
import {
  SYNTAX_IMPORT_RESOURCE_KIND_LIMIT,
  syntaxResourceSlug,
  toJsonObject,
} from './syntax-resource-import-utils'
import {
  decodeSource,
  hasCompleteAppearanceTokenGroups,
  isSourceObject,
  nativeAppearanceEntrySchema,
  nativeLanguageEntrySchema,
  nativePackageSourceSchema,
  nativeThemeEntrySchema,
} from './syntax-source-schemas'
import { normalizedTheme } from './syntax-theme-normalization'

function nativeAppearance(
  candidate: unknown,
  index: number,
  packageId: string,
  packageName: string,
  sourcePath: string,
  scope: SyntaxResourceScope,
): SyntaxAppearanceResource {
  const entry = isSourceObject(candidate)
    ? decodeUnknownOrThrow(nativeAppearanceEntrySchema, candidate)
    : undefined
  const rawTokens = entry?.tokens
  if (!entry || !isSourceObject(rawTokens)) {
    throw new Error(`Native appearance entry ${String(index + 1)} is malformed.`)
  }
  const { variant } = entry
  if (variant === undefined) {
    throw new Error(`Native appearance entry ${String(index + 1)} has an invalid variant.`)
  }
  if (!hasCompleteAppearanceTokenGroups(rawTokens)) {
    throw new Error(
      `Native appearance entry ${String(index + 1)} does not contain the complete semantic token groups.`,
    )
  }
  const original = toJsonObject(candidate)
  const tokens = toJsonObject(rawTokens)
  const revision = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  return {
    id: `appearance:${syntaxResourceSlug(packageId)}:${variant}`,
    packageId,
    revision,
    label: entry.label ?? `${packageName} ${variant}`,
    variant,
    scope,
    format: 'openwaggle',
    sourcePath,
    tokens,
    original,
  }
}

export function nativeSyntaxResources(
  raw: unknown,
  sourcePath: string,
  scope: SyntaxResourceScope,
) {
  const source = decodeSource(nativePackageSourceSchema, raw)
  if (
    source?.schemaVersion !== 1 ||
    (source.themes === undefined &&
      source.languages === undefined &&
      source.appearances === undefined)
  ) {
    return null
  }
  const themeCandidates = source.themes ?? []
  const languageCandidates = source.languages ?? []
  const appearanceCandidates = source.appearances ?? []
  if (
    themeCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT ||
    languageCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT ||
    appearanceCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT
  ) {
    throw new Error('A native syntax package declares too many resources of one kind.')
  }
  const publisher = source.publisher ?? 'local'
  const packageName = source.name ?? path.basename(sourcePath)
  const packageId = `${publisher}.${packageName}`
  const themes = themeCandidates.map((candidate, index) => {
    const entry = isSourceObject(candidate)
      ? decodeUnknownOrThrow(nativeThemeEntrySchema, candidate)
      : undefined
    if (!entry || !isSourceObject(entry.theme)) {
      throw new Error(`Native theme entry ${String(index + 1)} is malformed.`)
    }
    const { variant } = entry
    if (variant === undefined) {
      throw new Error(`Native theme entry ${String(index + 1)} has an invalid variant.`)
    }
    return normalizedTheme({
      raw: entry.theme,
      label: entry.label ?? `${packageName} ${variant}`,
      packageId,
      format: 'openwaggle',
      sourcePath,
      scope,
      forcedVariant: variant,
    })
  })
  const languages = languageCandidates.map((candidate, index) => {
    const entry = isSourceObject(candidate)
      ? decodeUnknownOrThrow(nativeLanguageEntrySchema, candidate)
      : undefined
    if (!entry || !isSourceObject(entry.grammar)) {
      throw new Error(`Native language entry ${String(index + 1)} is malformed.`)
    }
    const declaration = toJsonObject(candidate)
    return normalizedLanguage({
      grammar: entry.grammar,
      declaration,
      language: isSourceObject(entry.language) ? toJsonObject(entry.language) : declaration,
      packageId,
      format: 'openwaggle',
      sourcePath,
      scope,
      configuration: entry.configuration,
    })
  })
  const appearances = appearanceCandidates.map((candidate, index) =>
    nativeAppearance(candidate, index, packageId, packageName, sourcePath, scope),
  )
  return { themes, languages, appearances }
}
