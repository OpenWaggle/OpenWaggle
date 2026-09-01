import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'

const SYNTAX_PRIORITIES = ['visible', 'near-viewport', 'background'] as const
export type SyntaxPriority = (typeof SYNTAX_PRIORITIES)[number]

export interface SyntaxToken {
  readonly content: string
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontStyle?: number
}

export interface SyntaxHighlightResult {
  readonly status: 'highlighted' | 'plain-text'
  readonly language: string
  readonly theme: string
  readonly foreground?: string
  readonly background?: string
  readonly lines: readonly (readonly SyntaxToken[])[]
  readonly lineOffset?: number
  readonly diagnostic?: string
  readonly elapsedMs: number
}

export interface SyntaxLineRange {
  readonly start: number
  readonly end: number
}

export interface SyntaxHighlightRequest {
  readonly source: string
  readonly sourceFingerprint?: string
  readonly language: string
  readonly theme: string
  readonly priority?: SyntaxPriority
  readonly signal?: AbortSignal
  readonly lineRange?: SyntaxLineRange
}

export interface SyntaxWorkerHighlightMessage {
  readonly type: 'highlight'
  readonly requestId: number
  readonly source?: string
  readonly sourceKey: string
  readonly language: string
  readonly theme: string
  readonly lineRange?: SyntaxLineRange
}

export interface SyntaxWorkerValidateLanguageMessage {
  readonly type: 'validate-language'
  readonly requestId: number
  readonly language: SyntaxLanguageResource
}

export interface SyntaxWorkerRegisterThemesMessage {
  readonly type: 'register-themes'
  readonly themes: readonly SyntaxThemeRegistration[]
}

export interface SyntaxWorkerRegisterLanguagesMessage {
  readonly type: 'register-languages'
  readonly languages: readonly SyntaxLanguageResource[]
}

export interface SyntaxWorkerSuccessMessage {
  readonly type: 'highlighted'
  readonly requestId: number
  readonly result: SyntaxHighlightResult
  readonly retainedSourceKeys?: readonly string[]
}

export interface SyntaxWorkerFailureMessage {
  readonly type: 'failed'
  readonly requestId: number
  readonly message: string
}

export interface SyntaxWorkerSourceRequiredMessage {
  readonly type: 'source-required'
  readonly requestId: number
}

export interface SyntaxWorkerLanguageValidatedMessage {
  readonly type: 'language-validated'
  readonly requestId: number
  readonly languageId: string
}

export type SyntaxWorkerRequest =
  | SyntaxWorkerHighlightMessage
  | SyntaxWorkerValidateLanguageMessage
  | SyntaxWorkerRegisterThemesMessage
  | SyntaxWorkerRegisterLanguagesMessage
export type SyntaxWorkerResponse =
  | SyntaxWorkerSuccessMessage
  | SyntaxWorkerFailureMessage
  | SyntaxWorkerSourceRequiredMessage
  | SyntaxWorkerLanguageValidatedMessage

export { isSyntaxWorkerRequest, isSyntaxWorkerResponse } from './protocol-validation'

export function plainSyntaxResult(input: {
  readonly source: string
  readonly language: string
  readonly theme: string
  readonly diagnostic?: string
  readonly lineRange?: SyntaxLineRange
}): SyntaxHighlightResult {
  const allLines = input.source.split('\n')
  const start = Math.max(0, Math.min(input.lineRange?.start ?? 0, allLines.length))
  const end = Math.max(start, Math.min(input.lineRange?.end ?? allLines.length, allLines.length))
  return {
    status: 'plain-text',
    language: input.language,
    theme: input.theme,
    lines: allLines.slice(start, end).map((line) => [{ content: line }]),
    ...(start > 0 ? { lineOffset: start } : {}),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
    elapsedMs: 0,
  }
}
