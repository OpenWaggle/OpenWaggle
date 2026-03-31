import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const ICON_SIZE = 12

/**
 * Regex to match @file mentions in message text.
 * Matches @followed-by-non-whitespace, e.g. @src/main/index.ts or @AGENTS.md
 * The @ must be at start of string or after whitespace.
 */
const MENTION_REGEX = /(?:^|\s)(@\S+)/g

/**
 * Splits text into an array of ReactNode items, replacing @path patterns
 * with inline file mention chips. Plain text segments are returned as strings.
 */
export function renderTextWithMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of text.matchAll(MENTION_REGEX)) {
    const fullMatch = match[0]
    const mention = match[1]
    const matchStart = match.index + (fullMatch.length - mention.length)

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart))
    }

    const filePath = mention.slice(1)
    const slashIndex = filePath.lastIndexOf('/')
    const basename = slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath
    key += 1
    parts.push(
      <span
        key={key}
        className={cn(
          'bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[13px]',
          'inline-flex items-center gap-1',
          'select-none cursor-default',
        )}
        title={filePath}
      >
        <FileText size={ICON_SIZE} className="shrink-0" />
        <span>{basename}</span>
      </span>,
    )

    lastIndex = matchStart + mention.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

interface MentionTextProps {
  text: string
}

/**
 * Renders message text with inline file mention chips for @path patterns.
 */
export function MentionText({ text }: MentionTextProps) {
  const parts = renderTextWithMentions(text)

  if (parts.length === 0) {
    return <>{text}</>
  }

  return <>{parts}</>
}
