import type { TextRange } from '../../../lib/archived-items-view'

/** Text with the given ranges marked; ranges must be sorted and must not overlap. */
export function HighlightedText({
  text,
  ranges,
}: {
  readonly text: string
  readonly ranges: readonly TextRange[]
}) {
  if (ranges.length === 0) return text
  const parts: { readonly key: string; readonly text: string; readonly marked: boolean }[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push({ key: `t${String(cursor)}`, text: text.slice(cursor, start), marked: false })
    }
    parts.push({ key: `m${String(start)}`, text: text.slice(start, end), marked: true })
    cursor = end
  }
  if (cursor < text.length) {
    parts.push({ key: `t${String(cursor)}`, text: text.slice(cursor), marked: false })
  }
  return parts.map((part) =>
    part.marked ? (
      <mark key={part.key} className="rounded-sm bg-accent/20 text-inherit">
        {part.text}
      </mark>
    ) : (
      <span key={part.key}>{part.text}</span>
    ),
  )
}
