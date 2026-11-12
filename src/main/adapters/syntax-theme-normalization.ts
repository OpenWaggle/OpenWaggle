import { createHash } from 'node:crypto'
import { decodeUnknownOrThrow, type SchemaType } from '@shared/schema'
import type { SyntaxAppearanceVariant } from '@shared/types/syntax'
import type {
  SyntaxImportFormat,
  SyntaxResourceScope,
  SyntaxThemeResource,
  SyntaxThemeTokenRule,
} from '@shared/types/syntax-resources'
import { syntaxResourceSlug, toJsonObject } from './syntax-resource-import-utils'
import { isSourceObject, themeSourceSchema, themeTokenRulesSchema } from './syntax-source-schemas'

type ThemeSource = SchemaType<typeof themeSourceSchema>

const RUNTIME_REVISION_LENGTH = 16

function tokenRules(value: unknown): SyntaxThemeTokenRule[] {
  return decodeUnknownOrThrow(themeTokenRulesSchema, value).map((candidate) => {
    const { foreground, background, fontStyle } = candidate.settings
    return {
      ...(candidate.name === undefined ? {} : { name: candidate.name }),
      ...(candidate.scope ? { scope: candidate.scope } : {}),
      settings: {
        ...(foreground === undefined ? {} : { foreground }),
        ...(background === undefined ? {} : { background }),
        ...(fontStyle === undefined ? {} : { fontStyle }),
      },
    }
  })
}

function inferredThemeType(source: ThemeSource, label: string) {
  if (source.type === 'light') return 'light' as const
  if (source.type === 'dark') return 'dark' as const
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
  if (!isSourceObject(input.raw)) throw new Error('Theme declaration must be an object.')
  const original = toJsonObject(input.originalRaw ?? input.raw)
  const resolved = toJsonObject(input.raw)
  const source = decodeUnknownOrThrow(themeSourceSchema, input.raw)
  const type = inferredThemeType(source, input.label)
  const variant = input.forcedVariant ?? inferredVariant(type, input.label)
  const settings = tokenRules(source.settings ?? source.tokenColors)
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
      colors: source.colors,
      settings,
    },
    original,
  }
}
