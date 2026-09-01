import type { SyntaxToken } from './protocol'

export function syntaxTokens(
  lines: readonly (readonly {
    readonly content: string
    readonly color?: string
    readonly bgColor?: string
    readonly fontStyle?: number
  }[])[],
): SyntaxToken[][] {
  return lines.map((line) =>
    line.map((token) => ({
      content: token.content,
      ...(token.color ? { color: token.color } : {}),
      ...(token.bgColor ? { backgroundColor: token.bgColor } : {}),
      ...(token.fontStyle === undefined ? {} : { fontStyle: token.fontStyle }),
    })),
  )
}
