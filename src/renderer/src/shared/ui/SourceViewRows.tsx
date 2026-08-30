import { cn } from '@/shared/lib/cn'
import type { SyntaxHighlightResult, SyntaxToken } from '@/shared/lib/syntax/protocol'
import { syntaxTokenStyle } from '@/shared/lib/syntax/token-style'

function tokensForLine(
  result: SyntaxHighlightResult | null,
  lineIndex: number,
): readonly SyntaxToken[] | null {
  if (result?.status !== 'highlighted') return null
  return result.lines[lineIndex - (result.lineOffset ?? 0)] ?? null
}

export function SourceViewRows({
  lines,
  range,
  highlighted,
  targetLine,
  lineHeight,
  showLineNumbers,
  backgroundColor,
}: {
  readonly lines: readonly string[]
  readonly range: { readonly start: number; readonly end: number }
  readonly highlighted: SyntaxHighlightResult | null
  readonly targetLine?: number | null
  readonly lineHeight: number
  readonly showLineNumbers: boolean
  readonly backgroundColor?: string
}) {
  return lines.slice(range.start, range.end).map((line, visibleIndex) => {
    const lineIndex = range.start + visibleIndex
    const tokens = tokensForLine(highlighted, lineIndex)
    return (
      <li
        key={String(lineIndex)}
        data-line-number={lineIndex + 1}
        aria-posinset={lineIndex + 1}
        aria-setsize={lines.length}
        className={cn(
          'absolute left-0 flex min-w-full whitespace-pre',
          targetLine === lineIndex + 1 && 'bg-accent/10',
        )}
        style={{
          height: lineHeight,
          transform: `translateY(${String(lineIndex * lineHeight)}px)`,
        }}
      >
        {showLineNumbers ? (
          <span
            aria-hidden="true"
            className="sticky left-0 z-10 mr-4 inline-block w-12 shrink-0 select-none pr-2 text-right text-text-muted"
            style={{ backgroundColor: backgroundColor ?? 'var(--color-bg)' }}
          >
            {lineIndex + 1}
          </span>
        ) : null}
        <span>
          {tokens
            ? tokens.map((token, tokenIndex) => (
                <span key={String(tokenIndex)} style={syntaxTokenStyle(token)}>
                  {token.content}
                </span>
              ))
            : line}
        </span>
      </li>
    )
  })
}
