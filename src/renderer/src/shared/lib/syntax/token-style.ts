import type { SyntaxToken } from './protocol'

const FONT_STYLE_ITALIC = 1
const FONT_STYLE_BOLD = 2
const FONT_STYLE_UNDERLINE = 4
const BOLD_FONT_WEIGHT = 600

export function syntaxTokenStyle(token: SyntaxToken) {
  const fontStyle = token.fontStyle ?? 0
  return {
    ...(token.color ? { color: token.color } : {}),
    ...(token.backgroundColor ? { backgroundColor: token.backgroundColor } : {}),
    ...(fontStyle & FONT_STYLE_ITALIC ? { fontStyle: 'italic' } : {}),
    ...(fontStyle & FONT_STYLE_BOLD ? { fontWeight: BOLD_FONT_WEIGHT } : {}),
    ...(fontStyle & FONT_STYLE_UNDERLINE ? { textDecoration: 'underline' } : {}),
  }
}
