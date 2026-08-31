import { createHash } from 'node:crypto'
import path from 'node:path'
import type { SyntaxAppearanceVariant } from '@shared/types/syntax'
import type { SyntaxAppearanceResource, SyntaxResourceScope } from '@shared/types/syntax-resources'
import { normalizedLanguage } from './syntax-language-normalization'
import {
  isRecord,
  SYNTAX_IMPORT_RESOURCE_KIND_LIMIT,
  syntaxResourceSlug,
  toJsonObject,
} from './syntax-resource-import-utils'
import { normalizedTheme } from './syntax-theme-normalization'

const REQUIRED_APPEARANCE_GROUPS = [
  'color',
  'typography',
  'spacing',
  'radius',
  'shadow',
  'focus',
] as const

function isAppearanceVariant(value: unknown): value is SyntaxAppearanceVariant {
  return (
    value === 'light' ||
    value === 'dark' ||
    value === 'high-contrast-light' ||
    value === 'high-contrast-dark'
  )
}

function nativeAppearance(
  candidate: unknown,
  index: number,
  packageId: string,
  packageName: string,
  sourcePath: string,
  scope: SyntaxResourceScope,
): SyntaxAppearanceResource {
  if (!isRecord(candidate) || !isRecord(candidate.tokens)) {
    throw new Error(`Native appearance entry ${String(index + 1)} is malformed.`)
  }
  const rawTokens = candidate.tokens
  if (!isAppearanceVariant(candidate.variant)) {
    throw new Error(`Native appearance entry ${String(index + 1)} has an invalid variant.`)
  }
  if (REQUIRED_APPEARANCE_GROUPS.some((group) => !isRecord(rawTokens[group]))) {
    throw new Error(
      `Native appearance entry ${String(index + 1)} does not contain the complete semantic token groups.`,
    )
  }
  const original = toJsonObject(candidate)
  const tokens = toJsonObject(rawTokens)
  const revision = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  return {
    id: `appearance:${syntaxResourceSlug(packageId)}:${candidate.variant}`,
    packageId,
    revision,
    label:
      typeof candidate.label === 'string' ? candidate.label : `${packageName} ${candidate.variant}`,
    variant: candidate.variant,
    scope,
    format: 'openwaggle',
    sourcePath,
    tokens,
    original,
  }
}

export function nativeSyntaxResources(
  raw: Readonly<Record<string, unknown>>,
  sourcePath: string,
  scope: SyntaxResourceScope,
) {
  if (
    raw.schemaVersion !== 1 ||
    (!Array.isArray(raw.themes) && !Array.isArray(raw.languages) && !Array.isArray(raw.appearances))
  ) {
    return null
  }
  const themeCandidates = Array.isArray(raw.themes) ? raw.themes : []
  const languageCandidates = Array.isArray(raw.languages) ? raw.languages : []
  const appearanceCandidates = Array.isArray(raw.appearances) ? raw.appearances : []
  if (
    themeCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT ||
    languageCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT ||
    appearanceCandidates.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT
  ) {
    throw new Error('A native syntax package declares too many resources of one kind.')
  }
  const publisher = typeof raw.publisher === 'string' ? raw.publisher : 'local'
  const packageName = typeof raw.name === 'string' ? raw.name : path.basename(sourcePath)
  const packageId = `${publisher}.${packageName}`
  const themes = themeCandidates.map((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.theme)) {
      throw new Error(`Native theme entry ${String(index + 1)} is malformed.`)
    }
    if (!isAppearanceVariant(candidate.variant)) {
      throw new Error(`Native theme entry ${String(index + 1)} has an invalid variant.`)
    }
    return normalizedTheme({
      raw: candidate.theme,
      label:
        typeof candidate.label === 'string'
          ? candidate.label
          : `${packageName} ${candidate.variant}`,
      packageId,
      format: 'openwaggle',
      sourcePath,
      scope,
      forcedVariant: candidate.variant,
    })
  })
  const languages = languageCandidates.map((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.grammar)) {
      throw new Error(`Native language entry ${String(index + 1)} is malformed.`)
    }
    return normalizedLanguage({
      grammar: candidate.grammar,
      declaration: candidate,
      language: isRecord(candidate.language) ? candidate.language : candidate,
      packageId,
      format: 'openwaggle',
      sourcePath,
      scope,
      configuration: candidate.configuration,
    })
  })
  const appearances = appearanceCandidates.map((candidate, index) =>
    nativeAppearance(candidate, index, packageId, packageName, sourcePath, scope),
  )
  return { themes, languages, appearances }
}
