import { isSyntaxLanguageConfiguration } from '@shared/syntax-language-configuration'
import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import { isObjectValue } from '@shared/utils/object-shape'
import type {
  SyntaxHighlightResult,
  SyntaxToken,
  SyntaxWorkerRequest,
  SyntaxWorkerResponse,
} from './protocol'

/*
 * The syntax worker's messages are checked with `'name' in value` narrowing rather than an Effect
 * schema: the worker bundle has a size budget (scripts/check-syntax-bundle.ts) that the schema
 * runtime does not fit in. Each field is narrowed to a declared type and read with dot access.
 */

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isObjectValue(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

function isSafeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isThemeTokenSettings(value: unknown) {
  return (
    isObjectValue(value) &&
    isOptionalString('foreground' in value ? value.foreground : undefined) &&
    isOptionalString('background' in value ? value.background : undefined) &&
    isOptionalString('fontStyle' in value ? value.fontStyle : undefined)
  )
}

function isThemeTokenRule(rule: unknown) {
  if (!isObjectValue(rule) || !('settings' in rule) || !isThemeTokenSettings(rule.settings)) {
    return false
  }
  const scope = 'scope' in rule ? rule.scope : undefined
  return (
    isOptionalString('name' in rule ? rule.name : undefined) &&
    (isOptionalString(scope) || isStringArray(scope))
  )
}

function isSyntaxThemeRegistration(value: unknown): value is SyntaxThemeRegistration {
  return (
    isObjectValue(value) &&
    'colors' in value &&
    isStringRecord(value.colors) &&
    'settings' in value &&
    Array.isArray(value.settings) &&
    value.settings.every(isThemeTokenRule) &&
    'name' in value &&
    typeof value.name === 'string' &&
    'displayName' in value &&
    typeof value.displayName === 'string' &&
    'type' in value &&
    (value.type === 'light' || value.type === 'dark')
  )
}

function hasSyntaxLanguageIdentity(value: object) {
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'packageId' in value &&
    typeof value.packageId === 'string' &&
    'revision' in value &&
    typeof value.revision === 'string' &&
    'label' in value &&
    typeof value.label === 'string' &&
    'languageId' in value &&
    typeof value.languageId === 'string'
  )
}

function hasSyntaxLanguageMetadata(value: object) {
  return (
    hasSyntaxLanguageIdentity(value) &&
    'scope' in value &&
    (value.scope === 'bundled' || value.scope === 'user' || value.scope === 'project') &&
    'engine' in value &&
    (value.engine === 'javascript' || value.engine === 'oniguruma')
  )
}

function hasSyntaxLanguageNames(registration: object) {
  return (
    'name' in registration &&
    typeof registration.name === 'string' &&
    'displayName' in registration &&
    typeof registration.displayName === 'string' &&
    'scopeName' in registration &&
    typeof registration.scopeName === 'string' &&
    'aliases' in registration &&
    isStringArray(registration.aliases) &&
    'fileExtensions' in registration &&
    isStringArray(registration.fileExtensions) &&
    'fileNames' in registration &&
    isStringArray(registration.fileNames)
  )
}

function isSyntaxLanguageRegistration(registration: unknown) {
  if (!isObjectValue(registration) || !hasSyntaxLanguageNames(registration)) return false
  const configuration = 'configuration' in registration ? registration.configuration : undefined
  return (
    'embeddedLanguages' in registration &&
    isStringRecord(registration.embeddedLanguages) &&
    'injectTo' in registration &&
    isStringArray(registration.injectTo) &&
    'grammar' in registration &&
    isObjectValue(registration.grammar) &&
    (configuration === undefined || isSyntaxLanguageConfiguration(configuration))
  )
}

function isSyntaxLanguageResource(value: unknown): value is SyntaxLanguageResource {
  return (
    isObjectValue(value) &&
    hasSyntaxLanguageMetadata(value) &&
    'registration' in value &&
    isSyntaxLanguageRegistration(value.registration)
  )
}

function isSyntaxToken(value: unknown): value is SyntaxToken {
  if (!isObjectValue(value) || !('content' in value) || typeof value.content !== 'string') {
    return false
  }
  const fontStyle = 'fontStyle' in value ? value.fontStyle : undefined
  return (
    isOptionalString('color' in value ? value.color : undefined) &&
    isOptionalString('backgroundColor' in value ? value.backgroundColor : undefined) &&
    (fontStyle === undefined || (typeof fontStyle === 'number' && Number.isFinite(fontStyle)))
  )
}

function isTokenLines(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((line) => Array.isArray(line) && line.every((token) => isSyntaxToken(token)))
  )
}

function hasHighlightColors(value: object) {
  return (
    isOptionalString('foreground' in value ? value.foreground : undefined) &&
    isOptionalString('background' in value ? value.background : undefined) &&
    isOptionalString('diagnostic' in value ? value.diagnostic : undefined)
  )
}

function hasHighlightTiming(value: object) {
  const lineOffset = 'lineOffset' in value ? value.lineOffset : undefined
  return (
    (lineOffset === undefined || isSafeIndex(lineOffset)) &&
    'elapsedMs' in value &&
    typeof value.elapsedMs === 'number' &&
    Number.isFinite(value.elapsedMs)
  )
}

function isSyntaxHighlightResult(value: unknown): value is SyntaxHighlightResult {
  if (!isObjectValue(value) || !hasHighlightColors(value) || !hasHighlightTiming(value)) {
    return false
  }
  return (
    'status' in value &&
    (value.status === 'highlighted' || value.status === 'plain-text') &&
    'language' in value &&
    typeof value.language === 'string' &&
    'theme' in value &&
    typeof value.theme === 'string' &&
    'lines' in value &&
    isTokenLines(value.lines)
  )
}

function isLineRange(value: unknown) {
  return (
    isObjectValue(value) &&
    'start' in value &&
    isSafeIndex(value.start) &&
    'end' in value &&
    isSafeIndex(value.end) &&
    value.end >= value.start
  )
}

function hasRequestIdentity(value: object) {
  return 'requestId' in value && isSafeIndex(value.requestId)
}

function isThemeRegistrationRequest(value: object) {
  return (
    'type' in value &&
    value.type === 'register-themes' &&
    'themes' in value &&
    Array.isArray(value.themes) &&
    value.themes.every(isSyntaxThemeRegistration)
  )
}

function isLanguageRegistrationRequest(value: object) {
  return (
    'type' in value &&
    value.type === 'register-languages' &&
    'languages' in value &&
    Array.isArray(value.languages) &&
    value.languages.every(isSyntaxLanguageResource)
  )
}

function isValidateLanguageRequest(value: object) {
  return (
    'type' in value &&
    value.type === 'validate-language' &&
    hasRequestIdentity(value) &&
    'language' in value &&
    isSyntaxLanguageResource(value.language)
  )
}

function isHighlightRequest(value: object) {
  const lineRange = 'lineRange' in value ? value.lineRange : undefined
  return (
    'type' in value &&
    value.type === 'highlight' &&
    hasRequestIdentity(value) &&
    isOptionalString('source' in value ? value.source : undefined) &&
    'sourceKey' in value &&
    typeof value.sourceKey === 'string' &&
    'language' in value &&
    typeof value.language === 'string' &&
    'theme' in value &&
    typeof value.theme === 'string' &&
    (lineRange === undefined || isLineRange(lineRange))
  )
}

export function isSyntaxWorkerRequest(value: unknown): value is SyntaxWorkerRequest {
  if (!isObjectValue(value)) return false
  return (
    isThemeRegistrationRequest(value) ||
    isLanguageRegistrationRequest(value) ||
    isValidateLanguageRequest(value) ||
    isHighlightRequest(value)
  )
}

function isHighlightedResponse(value: object) {
  const retainedSourceKeys = 'retainedSourceKeys' in value ? value.retainedSourceKeys : undefined
  return (
    'result' in value &&
    isSyntaxHighlightResult(value.result) &&
    (retainedSourceKeys === undefined || isStringArray(retainedSourceKeys))
  )
}

export function isSyntaxWorkerResponse(value: unknown): value is SyntaxWorkerResponse {
  if (!isObjectValue(value) || !hasRequestIdentity(value) || !('type' in value)) return false
  if (value.type === 'source-required') return true
  if (value.type === 'failed') return 'message' in value && typeof value.message === 'string'
  if (value.type === 'language-validated') {
    return 'languageId' in value && typeof value.languageId === 'string'
  }
  return value.type === 'highlighted' && isHighlightedResponse(value)
}
