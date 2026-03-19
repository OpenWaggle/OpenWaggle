import type { Root } from 'hast'
import { useRef } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import type { Highlighter } from 'shiki'
import { unified } from 'unified'
import { safeMarkdownSanitizeSchema } from '@/lib/markdown-safety'
import { applyShikiToHast } from '@/lib/shiki/rehype-shiki-plugin'
import type { ShikiCache } from '@/lib/shiki/shiki-cache'

/** Unified processor that parses markdown → HAST and sanitizes. */
const prefixProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, safeMarkdownSanitizeSchema)

const CODE_FENCE_RE = /^`{3,}/gm
const MAX_CACHE_ENTRIES = 20
const DOUBLE_NEWLINE_LENGTH = '\n\n'.length
const FENCE_PARITY_DIVISOR = 2

interface IncrementalMarkdownResult {
  prefixHast: Root | null
  tail: string
  prefixKey: string
}

interface ShikiOptions {
  highlighter: Highlighter | undefined
  cache: ShikiCache
}

/**
 * Count opening/closing code fence markers (lines starting with 3+ backticks)
 * in the given text. An odd count means the text ends inside an open fence.
 */
function countCodeFences(text: string): number {
  const matches = text.match(CODE_FENCE_RE)
  return matches ? matches.length : 0
}

/**
 * Find the last `\n\n` boundary in `text` that is NOT inside a code fence.
 * Returns the index immediately after the `\n\n` (so prefix = text.slice(0, idx)
 * includes the trailing newlines), or -1 if no valid split point exists.
 */
export function findSplitIndex(text: string): number {
  let pos = text.length

  while (pos > 0) {
    const idx = text.lastIndexOf('\n\n', pos - 1)
    if (idx === -1) return -1

    const before = text.slice(0, idx)
    if (countCodeFences(before) % FENCE_PARITY_DIVISOR === 0) {
      return idx + DOUBLE_NEWLINE_LENGTH
    }

    pos = idx
  }

  return -1
}

/** Parse markdown text to sanitized HAST synchronously via unified. */
function parseToHast(markdown: string): Root {
  const mdast = prefixProcessor.parse(markdown)
  return prefixProcessor.runSync(mdast)
}

/**
 * Split streaming text into a stable parsed prefix (all complete paragraphs)
 * and a live tail (current in-progress paragraph). The prefix is parsed to HAST
 * once and cached; only the tail is re-parsed on each render.
 *
 * When `isStreaming` is false, no splitting occurs — returns the full text
 * as the tail for the standard ReactMarkdown path.
 */
export function useIncrementalMarkdown(
  text: string,
  isStreaming: boolean,
  shikiOptions: ShikiOptions,
): IncrementalMarkdownResult {
  const hastCacheRef = useRef(new Map<string, Root>())

  if (!isStreaming) {
    return { prefixHast: null, tail: text, prefixKey: '' }
  }

  const splitIdx = findSplitIndex(text)

  if (splitIdx === -1) {
    return { prefixHast: null, tail: text, prefixKey: '' }
  }

  const prefixText = text.slice(0, splitIdx)
  const tail = text.slice(splitIdx)
  const prefixKey = prefixText

  const cache = hastCacheRef.current
  const cached = cache.get(prefixKey)

  if (cached) {
    return { prefixHast: cached, tail, prefixKey }
  }

  // Parse to sanitized HAST, then apply Shiki highlighting in-place.
  // INVARIANT: `applyShikiToHast` mutates the tree. We store the mutated tree
  // in the cache and never pass it back through `applyShikiToHast` again —
  // cache hits return early above, before reaching this block.
  const hast = parseToHast(prefixText)

  applyShikiToHast(hast, {
    highlighter: shikiOptions.highlighter,
    isStreaming: false,
    cache: shikiOptions.cache,
  })

  // Evict oldest entries if cache is too large
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) {
      cache.delete(oldest.value)
    }
  }

  cache.set(prefixKey, hast)

  return { prefixHast: hast, tail, prefixKey }
}
