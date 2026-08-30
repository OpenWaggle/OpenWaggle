export type OpenWaggleExtensionSyntaxPriority = 'visible' | 'near-viewport' | 'background'

export interface OpenWaggleExtensionSyntaxHighlightInput {
  readonly source: string
  readonly language?: string
  readonly path?: string
  readonly priority?: OpenWaggleExtensionSyntaxPriority
}

export interface OpenWaggleExtensionSyntaxToken {
  readonly content: string
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontStyle?: number
}

export interface OpenWaggleExtensionSyntaxHighlightResult {
  readonly status: 'highlighted' | 'plain-text'
  readonly language: string
  readonly foreground?: string
  readonly background?: string
  readonly lines: readonly (readonly OpenWaggleExtensionSyntaxToken[])[]
  readonly diagnostic?: string
}

export interface OpenWaggleExtensionSyntaxSdk {
  readonly highlight: (
    input: OpenWaggleExtensionSyntaxHighlightInput,
  ) => Promise<OpenWaggleExtensionSyntaxHighlightResult>
}

export function createPlainExtensionSyntaxResult(input: {
  readonly source: string
  readonly language?: string
  readonly diagnostic?: string
}): OpenWaggleExtensionSyntaxHighlightResult {
  return {
    status: 'plain-text',
    language: input.language?.trim() || 'text',
    lines: input.source.split('\n').map((line) => [{ content: line }]),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
  }
}
