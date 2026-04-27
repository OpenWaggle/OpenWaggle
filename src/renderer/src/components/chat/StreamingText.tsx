import { useEffect, useState } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import type { Highlighter } from 'shiki'
import { cn } from '@/lib/cn'
import { type RehypePlugins, safeMarkdownSanitizeSchema } from '@/lib/markdown-safety'
import { getHighlighter } from '@/lib/shiki/highlighter'
import { createRehypeShikiPlugin } from '@/lib/shiki/rehype-shiki-plugin'
import { ShikiCache } from '@/lib/shiki/shiki-cache'
import { IncrementalMarkdown } from './IncrementalMarkdown'

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

function getRehypePlugins(highlighter: Highlighter | undefined): RehypePlugins {
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

export function StreamingText({ text, isStreaming = false, className }: StreamingTextProps) {
  const highlighter = useShikiHighlighter()

  if (!text) return null

  const rehypePlugins = getRehypePlugins(highlighter)

  return (
    <div className={cn('prose', className)}>
      <IncrementalMarkdown
        text={text}
        isStreaming={isStreaming}
        highlighter={highlighter}
        cache={shikiCache}
        rehypePlugins={rehypePlugins}
        tailRehypePlugins={isStreaming ? TAIL_STREAMING_PLUGINS : undefined}
      />
    </div>
  )
}
