import { createHash } from 'node:crypto'
import type { SyntaxAppearanceVariant } from '@shared/types/syntax'
import type {
  SyntaxImportFormat,
  SyntaxResourceScope,
  SyntaxThemeResource,
  SyntaxThemeTokenRule,
} from '@shared/types/syntax-resources'
import {
  isRecord,
  stringRecord,
  syntaxResourceSlug,
  toJsonObject,
} from './syntax-resource-import-utils'

const RUNTIME_REVISION_LENGTH = 16

function tokenRules(value: unknown) {
  if (!Array.isArray(value)) return []
  const rules: SyntaxThemeTokenRule[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || !isRecord(candidate.settings)) continue
    const foreground = candidate.settings.foreground
    const background = candidate.settings.background
    const fontStyle = candidate.settings.fontStyle
    const scopeValue = candidate.scope
    const scope =
      typeof scopeValue === 'string'
        ? scopeValue
        : Array.isArray(scopeValue) && scopeValue.every((entry) => typeof entry === 'string')
          ? scopeValue
          : undefined
    rules.push({
      ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
      ...(scope ? { scope } : {}),
      settings: {
        ...(typeof foreground === 'string' ? { foreground } : {}),
        ...(typeof background === 'string' ? { background } : {}),
        ...(typeof fontStyle === 'string' ? { fontStyle } : {}),
      },
    })
  }
  return rules
}

function inferredThemeType(raw: Readonly<Record<string, unknown>>, label: string) {
  if (raw.type === 'light') return 'light' as const
  if (raw.type === 'dark') return 'dark' as const
  if (/\blight\b/i.test(label)) return 'light' as const
  return 'dark' as const
}

function inferredVariant(type: 'light' | 'dark', label: string): SyntaxAppearanceVariant {
  const highContrast = /high[ -]?contrast|\bhc\b/i.test(label)
  if (highContrast) return type === 'light' ? 'high-contrast-light' : 'high-contrast-dark'
  return type
}

export function normalizedTheme(input: {
  readonly raw: unknown
  readonly originalRaw?: unknown
  readonly label: string
  readonly packageId: string
  readonly format: SyntaxImportFormat
  readonly sourcePath: string
  readonly scope: SyntaxResourceScope
  readonly forcedVariant?: SyntaxAppearanceVariant
  readonly declaredIdentity?: string
}): SyntaxThemeResource {
  if (!isRecord(input.raw)) throw new Error('Theme declaration must be an object.')
  const original = toJsonObject(input.originalRaw ?? input.raw)
  const resolved = toJsonObject(input.raw)
  const type = inferredThemeType(input.raw, input.label)
  const variant = input.forcedVariant ?? inferredVariant(type, input.label)
  const settings = tokenRules(input.raw.settings ?? input.raw.tokenColors)
  if (settings.length === 0) throw new Error(`Theme "${input.label}" has no TextMate token rules.`)
  const revision = createHash('sha256').update(JSON.stringify({ original, resolved })).digest('hex')
  const declaredIdentity = input.declaredIdentity
    ? `:${syntaxResourceSlug(input.declaredIdentity)}`
    : ''
  const id = `theme:${syntaxResourceSlug(input.packageId)}${declaredIdentity}:${variant}`
  const runtimeName = `${id}:${revision.slice(0, RUNTIME_REVISION_LENGTH)}`
  return {
    id,
    packageId: input.packageId,
    revision,
    label: input.label,
    variant,
    scope: input.scope,
    format: input.format,
    sourcePath: input.sourcePath,
    theme: {
      name: runtimeName,
      displayName: input.label,
      type,
      colors: stringRecord(input.raw.colors),
      settings,
    },
    original,
  }
}
