import { useEffect, useRef, useState } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import type { Highlighter } from 'shiki'
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

interface PluginsCacheState {
  hl: Highlighter | undefined
  plugins: RehypePlugins
}

export function StreamingText({ text, isStreaming = false }: StreamingTextProps) {
  const highlighter = useShikiHighlighter()
  const pluginsRef = useRef<PluginsCacheState | null>(null)

  if (!text) return null

  // Stabilize the rehypePlugins array — only recreate when highlighter changes.
  let rehypePlugins: RehypePlugins
  const cached = pluginsRef.current
  if (cached !== null && cached.hl === highlighter) {
    rehypePlugins = cached.plugins
  } else {
    rehypePlugins = [
      createRehypeShikiPlugin({ highlighter, cache: shikiCache }),
      SANITIZE_PLUGIN_TUPLE,
    ]
    pluginsRef.current = { hl: highlighter, plugins: rehypePlugins }
  }

  return (
    <div className="prose">
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
