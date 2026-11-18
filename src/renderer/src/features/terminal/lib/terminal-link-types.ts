export type TerminalLinkSource = 'plain' | 'osc8'

export interface TerminalLinkResolutionContext {
  /** The terminal's absolute Working path. */
  readonly cwd: string
  /** Root that is allowed to use OpenWaggle's confined workspace preview. */
  readonly projectRoot?: string | null
  /** Optional home directory used to expand `~/` references. */
  readonly homePath?: string | null
}

export interface TerminalUrlActivationTarget {
  readonly kind: 'url'
  readonly source: TerminalLinkSource
  readonly url: string
  /** URL preference chooses the in-app preview or its external-browser fallback. */
  readonly route: 'url-preview'
}

export interface TerminalFileActivationTarget {
  readonly kind: 'file'
  readonly source: TerminalLinkSource
  readonly rawPath: string
  readonly resolvedPath: string
  readonly line: number | null
  readonly column: number | null
  /**
   * Non-null only when the lexically resolved path stays inside projectRoot.
   * The workspace service must still enforce its realpath boundary.
   */
  readonly projectRelativePath: string | null
  readonly route: 'workspace-preview' | 'external-editor'
  readonly resolution: 'absolute' | 'cwd-relative' | 'home-relative' | 'home-unresolved'
}

export type TerminalLinkActivationTarget =
  | TerminalUrlActivationTarget
  | TerminalFileActivationTarget

export interface TerminalLinkMatch {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly target: TerminalLinkActivationTarget
}

export interface TerminalLinkBufferPosition {
  readonly x: number
  readonly y: number
}

export interface TerminalLinkBufferRange {
  readonly start: TerminalLinkBufferPosition
  readonly end: TerminalLinkBufferPosition
}

export interface TerminalBufferCellLike {
  getChars(): string
  getWidth(): number
}

export interface TerminalBufferLineLike {
  readonly isWrapped?: boolean
  readonly length?: number
  getCell?(column: number): TerminalBufferCellLike | undefined
  translateToString(trimRight?: boolean): string
}

export interface WrappedTerminalLinkLineSegment {
  readonly bufferLineNumber: number
  readonly text: string
  readonly startIndex: number
  readonly endIndex: number
  readonly columnsByTextIndex: readonly number[]
}

export interface WrappedTerminalLinkLine {
  readonly text: string
  readonly segments: readonly WrappedTerminalLinkLineSegment[]
}
