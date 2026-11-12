import { isSyntaxLanguageConfiguration } from '@shared/syntax-language-configuration'
import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import type {
  SyntaxHighlightResult,
  SyntaxToken,
  SyntaxWorkerRequest,
  SyntaxWorkerResponse,
} from './protocol'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isSyntaxThemeRegistration(value: unknown): value is SyntaxThemeRegistration {
  if (!isRecord(value) || !isStringRecord(value.colors) || !Array.isArray(value.settings)) {
    return false
  }
  return (
    typeof value.name === 'string' &&
    typeof value.displayName === 'string' &&
    (value.type === 'light' || value.type === 'dark') &&
    value.settings.every(
      (rule) =>
        isRecord(rule) &&
        isRecord(rule.settings) &&
        (rule.name === undefined || typeof rule.name === 'string') &&
        (rule.scope === undefined || typeof rule.scope === 'string' || isStringArray(rule.scope)) &&
        (rule.settings.foreground === undefined || typeof rule.settings.foreground === 'string') &&
        (rule.settings.background === undefined || typeof rule.settings.background === 'string') &&
        (rule.settings.fontStyle === undefined || typeof rule.settings.fontStyle === 'string'),
    )
  )
}

function hasSyntaxLanguageMetadata(value: Readonly<Record<string, unknown>>) {
  return (
    typeof value.id === 'string' &&
    typeof value.packageId === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.label === 'string' &&
    typeof value.languageId === 'string' &&
    (value.scope === 'bundled' || value.scope === 'user' || value.scope === 'project') &&
    (value.engine === 'javascript' || value.engine === 'oniguruma')
  )
}

function isSyntaxLanguageRegistration(registration: Readonly<Record<string, unknown>>) {
  return (
    typeof registration.name === 'string' &&
    typeof registration.displayName === 'string' &&
    typeof registration.scopeName === 'string' &&
    isStringArray(registration.aliases) &&
    isStringArray(registration.fileExtensions) &&
    isStringArray(registration.fileNames) &&
    isStringRecord(registration.embeddedLanguages) &&
    isStringArray(registration.injectTo) &&
    isRecord(registration.grammar) &&
    (registration.configuration === undefined ||
      isSyntaxLanguageConfiguration(registration.configuration))
  )
}

function isSyntaxLanguageResource(value: unknown): value is SyntaxLanguageResource {
  return (
    isRecord(value) &&
    hasSyntaxLanguageMetadata(value) &&
    isRecord(value.registration) &&
    isSyntaxLanguageRegistration(value.registration)
  )
}

function isSyntaxToken(value: unknown): value is SyntaxToken {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    (value.color === undefined || typeof value.color === 'string') &&
    (value.backgroundColor === undefined || typeof value.backgroundColor === 'string') &&
    (value.fontStyle === undefined ||
      (typeof value.fontStyle === 'number' && Number.isFinite(value.fontStyle)))
  )
}

function isTokenLines(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((line) => Array.isArray(line) && line.every((token) => isSyntaxToken(token)))
  )
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

function isOptionalLineOffset(value: unknown) {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
}

function isSyntaxHighlightResult(value: unknown): value is SyntaxHighlightResult {
  return (
    isRecord(value) &&
    (value.status === 'highlighted' || value.status === 'plain-text') &&
    typeof value.language === 'string' &&
    typeof value.theme === 'string' &&
    isOptionalString(value.foreground) &&
    isOptionalString(value.background) &&
    isOptionalString(value.diagnostic) &&
    isOptionalLineOffset(value.lineOffset) &&
    typeof value.elapsedMs === 'number' &&
    Number.isFinite(value.elapsedMs) &&
    isTokenLines(value.lines)
  )
}

function isLineRange(value: unknown) {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.start) &&
    Number(value.start) >= 0 &&
    Number.isSafeInteger(value.end) &&
    Number(value.end) >= Number(value.start)
  )
}

function hasRequestIdentity(value: Readonly<Record<string, unknown>>) {
  return Number.isSafeInteger(value.requestId) && Number(value.requestId) >= 0
}

function isThemeRegistrationRequest(value: Readonly<Record<string, unknown>>) {
  return (
    value.type === 'register-themes' &&
    Array.isArray(value.themes) &&
    value.themes.every(isSyntaxThemeRegistration)
  )
}

function isLanguageRegistrationRequest(value: Readonly<Record<string, unknown>>) {
  return (
    value.type === 'register-languages' &&
    Array.isArray(value.languages) &&
    value.languages.every(isSyntaxLanguageResource)
  )
}

function isHighlightRequest(value: Readonly<Record<string, unknown>>) {
  return (
    value.type === 'highlight' &&
    hasRequestIdentity(value) &&
    (value.source === undefined || typeof value.source === 'string') &&
    typeof value.sourceKey === 'string' &&
    typeof value.language === 'string' &&
    typeof value.theme === 'string' &&
    (value.lineRange === undefined || isLineRange(value.lineRange))
  )
}

export function isSyntaxWorkerRequest(value: unknown): value is SyntaxWorkerRequest {
  if (!isRecord(value)) return false
  return (
    isThemeRegistrationRequest(value) ||
    isLanguageRegistrationRequest(value) ||
    (value.type === 'validate-language' &&
      hasRequestIdentity(value) &&
      isSyntaxLanguageResource(value.language)) ||
    isHighlightRequest(value)
  )
}

export function isSyntaxWorkerResponse(value: unknown): value is SyntaxWorkerResponse {
  if (!isRecord(value) || !hasRequestIdentity(value)) return false
  if (value.type === 'source-required') return true
  if (value.type === 'failed') return typeof value.message === 'string'
  if (value.type === 'language-validated') return typeof value.languageId === 'string'
  return (
    value.type === 'highlighted' &&
    isSyntaxHighlightResult(value.result) &&
    (value.retainedSourceKeys === undefined || isStringArray(value.retainedSourceKeys))
  )
}
