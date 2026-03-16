import { useEffect, useState } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import type { Highlighter } from 'shiki'
import { useThrottledStreamText } from '@/hooks/useThrottledStreamText'
import { type RehypePlugins, safeMarkdownSanitizeSchema } from '@/lib/markdown-safety'
import { getHighlighter } from '@/lib/shiki/highlighter'
import { createRehypeShikiPlugin } from '@/lib/shiki/rehype-shiki-plugin'
import { ShikiCache } from '@/lib/shiki/shiki-cache'
import { IncrementalMarkdown } from './IncrementalMarkdown'

/** Module-level cache shared by all StreamingText instances. */
const shikiCache = new ShikiCache()

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
}

/**
 * Hook that returns the Shiki highlighter once loaded.
 * Triggers a single re-render when the highlighter becomes available.
 */
function useShikiHighlighter(): Highlighter | undefined {
  const [hl, setHl] = useState<Highlighter | undefined>(() => resolvedHighlighter)

  useEffect(() => {
    if (hl !== undefined) return
    highlighterReady.then(setHl)
  }, [hl])

  return hl
}

export function StreamingText({ text, isStreaming = false }: StreamingTextProps) {
  const displayText = useThrottledStreamText(text, isStreaming)
  const highlighter = useShikiHighlighter()

  if (!displayText) return null

  const rehypePlugins: RehypePlugins = [
    createRehypeShikiPlugin({ highlighter, isStreaming, cache: shikiCache }),
    [rehypeSanitize, safeMarkdownSanitizeSchema],
  ]

  return (
    <div className="prose">
      {/* key changes when highlighter first loads — forces IncrementalMarkdown to
          remount and re-render with Shiki highlighting instead of staying stale. */}
      <IncrementalMarkdown
        key={highlighter === undefined ? 'no-hl' : 'hl'}
        text={displayText}
        isStreaming={isStreaming}
        highlighter={highlighter}
        cache={shikiCache}
        rehypePlugins={rehypePlugins}
      />
    </div>
  )
}
