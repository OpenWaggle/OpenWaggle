import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReference } from '@shared/types/inline-visualization'
import {
  findNextVisualizationReferenceMatch,
  withholdUnresolvedVisualizationSuffix,
} from '@shared/utils/inline-visualization'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/shared/lib/cn'
import { type RehypePlugins, safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety'
import { useChatDisplayMarkdownFormatter } from './ChatDisplayPathContext'
import { IncrementalMarkdown } from './IncrementalMarkdown'
import { InlineVisualization } from './InlineVisualization'

/** Sanitize plugin tuple — never changes, hoisted to module scope. */
const SANITIZE_PLUGIN_TUPLE: RehypePlugins[number] = [rehypeSanitize, safeMarkdownSanitizeSchema]

/** Tail parsing stays lightweight; fenced code delegates incremental tokenization to SyntaxBlock. */
const TAIL_STREAMING_PLUGINS: RehypePlugins = [SANITIZE_PLUGIN_TUPLE]
const MARKDOWN_PLUGINS: RehypePlugins = [SANITIZE_PLUGIN_TUPLE]

interface StreamingTextProps {
  text: string
  isStreaming?: boolean
  className?: string
  visualizationSessionId?: SessionId | null
  visualizationInteractionSessionId?: SessionId | null
}

type StreamingContentSegment =
  | { readonly type: 'markdown'; readonly text: string; readonly sourceOffset: number }
  | {
      readonly type: 'visualization'
      readonly reference: InlineVisualizationReference
      readonly sourceOffset: number
    }

function splitStreamingContent(text: string, isStreaming: boolean): StreamingContentSegment[] {
  const visibleText = isStreaming ? withholdUnresolvedVisualizationSuffix(text) : text
  const segments: StreamingContentSegment[] = []
  let scanFrom = 0
  let markdownStart = 0

  while (scanFrom < visibleText.length) {
    const match = findNextVisualizationReferenceMatch(visibleText, scanFrom)
    if (!match) break

    if (match.kind === 'unterminated') {
      if (isStreaming) {
        if (match.start > markdownStart) {
          segments.push({
            type: 'markdown',
            text: visibleText.slice(markdownStart, match.start),
            sourceOffset: markdownStart,
          })
        }
        markdownStart = visibleText.length
      }
      break
    }

    if (match.start > markdownStart) {
      segments.push({
        type: 'markdown',
        text: visibleText.slice(markdownStart, match.start),
        sourceOffset: markdownStart,
      })
    }
    segments.push({ type: 'visualization', reference: match.reference, sourceOffset: match.start })
    scanFrom = match.end
    markdownStart = scanFrom
  }

  if (markdownStart < visibleText.length) {
    segments.push({
      type: 'markdown',
      text: visibleText.slice(markdownStart),
      sourceOffset: markdownStart,
    })
  }

  return segments.length > 0
    ? segments
    : visibleText.length > 0
      ? [{ type: 'markdown', text: visibleText, sourceOffset: 0 }]
      : []
}

export function StreamingText({
  text,
  isStreaming = false,
  className,
  visualizationSessionId,
  visualizationInteractionSessionId,
}: StreamingTextProps) {
  const formatDisplayMarkdown = useChatDisplayMarkdownFormatter()

  if (!text) return null

  const segments = visualizationSessionId
    ? splitStreamingContent(text, isStreaming)
    : [{ type: 'markdown' as const, text, sourceOffset: 0 }]

  return segments.map((segment) => {
    if (segment.type === 'visualization') {
      if (!visualizationSessionId) return null
      return (
        <InlineVisualization
          key={`visualization-${String(segment.sourceOffset)}`}
          sessionId={visualizationSessionId}
          interactionSessionId={visualizationInteractionSessionId ?? null}
          reference={segment.reference}
        />
      )
    }
    if (!segment.text) return null
    return (
      <div key={`markdown-${String(segment.sourceOffset)}`} className={cn('prose', className)}>
        <IncrementalMarkdown
          text={formatDisplayMarkdown(segment.text)}
          isStreaming={isStreaming}
          rehypePlugins={MARKDOWN_PLUGINS}
          tailRehypePlugins={isStreaming ? TAIL_STREAMING_PLUGINS : undefined}
        />
      </div>
    )
  })
}
