import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/shared/lib/cn'
import { type RehypePlugins, safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety'
import { useChatDisplayMarkdown } from './ChatDisplayPathContext'
import { IncrementalMarkdown } from './IncrementalMarkdown'

/** Sanitize plugin tuple — never changes, hoisted to module scope. */
const SANITIZE_PLUGIN_TUPLE: RehypePlugins[number] = [rehypeSanitize, safeMarkdownSanitizeSchema]

/** Tail parsing stays lightweight; fenced code delegates incremental tokenization to SyntaxBlock. */
const TAIL_STREAMING_PLUGINS: RehypePlugins = [SANITIZE_PLUGIN_TUPLE]
const MARKDOWN_PLUGINS: RehypePlugins = [SANITIZE_PLUGIN_TUPLE]

interface StreamingTextProps {
  text: string
  isStreaming?: boolean
  className?: string
}

export function StreamingText({ text, isStreaming = false, className }: StreamingTextProps) {
  const displayText = useChatDisplayMarkdown(text)
  if (!text) return null

  return (
    <div className={cn('prose', className)}>
      <IncrementalMarkdown
        text={displayText}
        isStreaming={isStreaming}
        rehypePlugins={MARKDOWN_PLUGINS}
        tailRehypePlugins={isStreaming ? TAIL_STREAMING_PLUGINS : undefined}
      />
    </div>
  )
}
