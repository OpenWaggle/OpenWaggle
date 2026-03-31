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

// ---------------------------------------------------------------------------
// Incremental split state — tracks scan progress to avoid O(n²) rescanning
// ---------------------------------------------------------------------------

interface SplitScanState {
  /** The text we have scanned up to. */
  scannedText: string
  /** Cumulative fence count across all scanned text. */
  fenceCount: number
  /** Last valid split index found (or -1). */
  lastSplitIdx: number
}

/**
 * Incrementally find the split index by only scanning new text.
 * If text doesn't extend the previous scan, falls back to a full scan.
 */
function findSplitIndexIncremental(text: string, state: SplitScanState): number {
  // If text is an extension of what we already scanned, only scan the delta
  if (text.startsWith(state.scannedText) && text.length > state.scannedText.length) {
    const delta = text.slice(state.scannedText.length)
    const deltaFences = countCodeFences(delta)
    state.fenceCount += deltaFences
    state.scannedText = text

    // Search backward from end for a valid split in the new region
    // but also check any split found against total fence parity
    let pos = text.length
    while (pos > 0) {
      const idx = text.lastIndexOf('\n\n', pos - 1)
      if (idx === -1) break

      const fencesBefore = countCodeFences(text.slice(0, idx))
      if (fencesBefore % FENCE_PARITY_DIVISOR === 0) {
        state.lastSplitIdx = idx + DOUBLE_NEWLINE_LENGTH
        return state.lastSplitIdx
      }
      pos = idx
    }

    // No valid split found — preserve previous result if still valid
    if (state.lastSplitIdx > 0 && state.lastSplitIdx <= text.length) {
      return state.lastSplitIdx
    }
    return -1
  }

  // Non-monotonic change or first call — full scan
  state.scannedText = text
  state.fenceCount = countCodeFences(text)
  state.lastSplitIdx = findSplitIndex(text)
  return state.lastSplitIdx
}

// ---------------------------------------------------------------------------
// Incremental prefix state — avoids re-parsing entire prefix on growth
// ---------------------------------------------------------------------------

interface PrefixState {
  text: string
  hast: Root
}

/**
 * Split streaming text into a stable parsed prefix (all complete paragraphs)
 * and a live tail (current in-progress paragraph). The prefix is parsed to HAST
 * once and incrementally extended; only the tail is re-parsed on each render.
 *
 * When `isStreaming` is false, no splitting occurs — returns the full text
 * as the tail for the standard ReactMarkdown path.
 */
export function useIncrementalMarkdown(
  text: string,
  isStreaming: boolean,
  shikiOptions: ShikiOptions,
): IncrementalMarkdownResult {
  const prefixStateRef = useRef<PrefixState | null>(null)
  const splitStateRef = useRef<SplitScanState>({
    scannedText: '',
    fenceCount: 0,
    lastSplitIdx: -1,
  })

  // Invalidate prefix cache when highlighter changes (e.g., from undefined to loaded)
  const prevHighlighterRef = useRef(shikiOptions.highlighter)
  if (prevHighlighterRef.current !== shikiOptions.highlighter) {
    prevHighlighterRef.current = shikiOptions.highlighter
    prefixStateRef.current = null
  }

  if (!isStreaming) {
    return { prefixHast: null, tail: text, prefixKey: '' }
  }

  const splitIdx = findSplitIndexIncremental(text, splitStateRef.current)

  if (splitIdx === -1) {
    return { prefixHast: null, tail: text, prefixKey: '' }
  }

  const prefixText = text.slice(0, splitIdx)
  const tail = text.slice(splitIdx)
  const prev = prefixStateRef.current

  // Same prefix as before — return cached
  if (prev && prefixText === prev.text) {
    return { prefixHast: prev.hast, tail, prefixKey: prefixText }
  }

  // Incremental growth: prefix extends the previous prefix.
  // Create a NEW Root so React detects the prop change and re-renders PrefixView.
  // (Mutating prev.hast in-place returns the same reference, which React Compiler
  // auto-memoization treats as "unchanged" and skips re-rendering.)
  if (prev && prefixText.startsWith(prev.text)) {
    const newMarkdown = prefixText.slice(prev.text.length)
    const newHast = parseToHast(newMarkdown)
    applyShikiToHast(newHast, {
      highlighter: shikiOptions.highlighter,
      cache: shikiOptions.cache,
    })
    const combined: Root = {
      type: 'root',
      children: [...prev.hast.children, ...newHast.children],
    }
    prefixStateRef.current = { text: prefixText, hast: combined }
    return { prefixHast: combined, tail, prefixKey: prefixText }
  }

  // Full re-parse (first time or non-monotonic change)
  const hast = parseToHast(prefixText)

  // INVARIANT: `applyShikiToHast` mutates the tree. We store the mutated tree
  // in the prefix state and never pass it back through `applyShikiToHast` again —
  // same-prefix checks return early above, before reaching this block.
  applyShikiToHast(hast, {
    highlighter: shikiOptions.highlighter,
    cache: shikiOptions.cache,
  })

  prefixStateRef.current = { text: prefixText, hast }

  return { prefixHast: hast, tail, prefixKey: prefixText }
}
