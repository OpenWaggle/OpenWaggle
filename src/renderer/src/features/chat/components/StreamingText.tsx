import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReference } from '@shared/types/inline-visualization'
import {
  parseInlineVisualizationReference,
  VISUALIZE_REFERENCE_END,
  VISUALIZE_REFERENCE_START,
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
  let visibleText = text
  if (isStreaming) {
    const maximumSuffixLength = Math.min(text.length, VISUALIZE_REFERENCE_START.length - 1)
    for (let length = maximumSuffixLength; length > 0; length -= 1) {
      if (text.endsWith(VISUALIZE_REFERENCE_START.slice(0, length))) {
        visibleText = text.slice(0, -length)
        break
      }
    }
  }
  const segments: StreamingContentSegment[] = []
  let scanFrom = 0
  let markdownStart = 0

  while (scanFrom < visibleText.length) {
    const start = visibleText.indexOf(VISUALIZE_REFERENCE_START, scanFrom)
    if (start === -1) break

    const payloadStart = start + VISUALIZE_REFERENCE_START.length
    const end = visibleText.indexOf(VISUALIZE_REFERENCE_END, payloadStart)
    if (end === -1) {
      if (isStreaming) {
        if (start > markdownStart) {
          segments.push({
            type: 'markdown',
            text: visibleText.slice(markdownStart, start),
            sourceOffset: markdownStart,
          })
        }
        markdownStart = visibleText.length
      }
      break
    }

    const reference = parseInlineVisualizationReference(visibleText.slice(payloadStart, end))
    if (reference === null) {
      scanFrom = end + VISUALIZE_REFERENCE_END.length
      continue
    }

    if (start > markdownStart) {
      segments.push({
        type: 'markdown',
        text: visibleText.slice(markdownStart, start),
        sourceOffset: markdownStart,
      })
    }
    segments.push({ type: 'visualization', reference, sourceOffset: start })
    scanFrom = end + VISUALIZE_REFERENCE_END.length
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
