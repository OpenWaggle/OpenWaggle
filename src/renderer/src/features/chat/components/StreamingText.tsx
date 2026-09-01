import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReference } from '@shared/types/inline-visualization'
import {
  parseInlineVisualizationReference,
  VISUALIZE_REFERENCE_END,
  VISUALIZE_REFERENCE_START,
} from '@shared/utils/inline-visualization'
import { useEffect, useState } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import type { Highlighter } from 'shiki'
import { cn } from '@/shared/lib/cn'
import { type RehypePlugins, safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety'
import { getHighlighter } from '@/shared/lib/shiki/highlighter'
import { createRehypeShikiPlugin } from '@/shared/lib/shiki/rehype-shiki-plugin'
import { ShikiCache } from '@/shared/lib/shiki/shiki-cache'
import { useChatDisplayMarkdownFormatter } from './ChatDisplayPathContext'
import { IncrementalMarkdown } from './IncrementalMarkdown'
import { InlineVisualization } from './InlineVisualization'

/** Module-level cache shared by all StreamingText instances. */
const shikiCache = new ShikiCache()

/** Sanitize plugin tuple — never changes, hoisted to module scope. */
const SANITIZE_PLUGIN_TUPLE: RehypePlugins[number] = [rehypeSanitize, safeMarkdownSanitizeSchema]

/**
 * Tail-only plugins for streaming: sanitize only, skip Shiki.
 * During streaming, code blocks in the tail change every token, causing 100%
 * Shiki cache miss rate (content-addressed keys). Deferring highlighting to
 * the prefix (on paragraph completion) avoids ~5-20ms/token of wasted work.
 */
const TAIL_STREAMING_PLUGINS: RehypePlugins = [SANITIZE_PLUGIN_TUPLE]
const NO_HIGHLIGHTER_PLUGINS: RehypePlugins = [
  createRehypeShikiPlugin({ highlighter: undefined, cache: shikiCache }),
  SANITIZE_PLUGIN_TUPLE,
]
const HIGHLIGHTER_PLUGIN_CACHE = new WeakMap<Highlighter, RehypePlugins>()

/**
 * Module-level resolved highlighter.
 * Set once the singleton promise resolves; read synchronously on each render.
 */
let resolvedHighlighter: Highlighter | undefined

/** Start loading eagerly at module evaluation time. */
const highlighterReady = getHighlighter().then((hl) => {
  resolvedHighlighter = hl
  return hl
})

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

/**
 * Hook that returns the Shiki highlighter once loaded.
 * Triggers a single re-render when the highlighter becomes available.
 */
function useShikiHighlighter() {
  const [hl, setHl] = useState<Highlighter | undefined>(() => resolvedHighlighter)

  useEffect(() => {
    if (hl !== undefined) return
    highlighterReady.then(setHl)
  }, [hl])

  return hl
}

function getRehypePlugins(highlighter: Highlighter | undefined) {
  if (!highlighter) {
    return NO_HIGHLIGHTER_PLUGINS
  }

  const cachedPlugins = HIGHLIGHTER_PLUGIN_CACHE.get(highlighter)
  if (cachedPlugins) {
    return cachedPlugins
  }

  const plugins: RehypePlugins = [
    createRehypeShikiPlugin({ highlighter, cache: shikiCache }),
    SANITIZE_PLUGIN_TUPLE,
  ]
  HIGHLIGHTER_PLUGIN_CACHE.set(highlighter, plugins)
  return plugins
}

export function StreamingText({
  text,
  isStreaming = false,
  className,
  visualizationSessionId,
  visualizationInteractionSessionId,
}: StreamingTextProps) {
  const highlighter = useShikiHighlighter()
  const formatDisplayMarkdown = useChatDisplayMarkdownFormatter()

  if (!text) return null

  const rehypePlugins = getRehypePlugins(highlighter)

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
          highlighter={highlighter}
          cache={shikiCache}
          rehypePlugins={rehypePlugins}
          tailRehypePlugins={isStreaming ? TAIL_STREAMING_PLUGINS : undefined}
        />
      </div>
    )
  })
}
