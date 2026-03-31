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
  /** The text length we have scanned up to. */
  scannedLength: number
  /** Cumulative fence count across all scanned text (up to scannedLength). */
  fenceCount: number
  /** Last valid split index found (or -1). */
  lastSplitIdx: number
}

const INITIAL_SPLIT_STATE: SplitScanState = { scannedLength: 0, fenceCount: 0, lastSplitIdx: -1 }

function resetSplitState(state: SplitScanState): void {
  state.scannedLength = INITIAL_SPLIT_STATE.scannedLength
  state.fenceCount = INITIAL_SPLIT_STATE.fenceCount
  state.lastSplitIdx = INITIAL_SPLIT_STATE.lastSplitIdx
}

/**
 * Incrementally find the split index by only scanning new text.
 * Uses cumulative fence count to determine parity without re-scanning the
 * entire prefix. Falls back to a full scan on non-monotonic text changes.
 *
 * Amortized O(delta) per call where delta = new tokens since last call.
 */
function findSplitIndexIncremental(text: string, state: SplitScanState): number {
  if (text.length <= state.scannedLength) {
    // Text shrunk or unchanged — full reset
    resetSplitState(state)
    state.scannedLength = text.length
    state.fenceCount = countCodeFences(text)
    state.lastSplitIdx = findSplitIndex(text)
    return state.lastSplitIdx
  }

  // Text grew — only scan the delta for fences
  const delta = text.slice(state.scannedLength)
  const deltaFences = countCodeFences(delta)
  state.fenceCount += deltaFences
  state.scannedLength = text.length

  // If total fence count is odd, we're inside an open code block —
  // no valid split can exist beyond the last known one.
  if (state.fenceCount % FENCE_PARITY_DIVISOR !== 0) {
    // Preserve previous split if still in bounds
    if (state.lastSplitIdx > 0 && state.lastSplitIdx <= text.length) {
      return state.lastSplitIdx
    }
    return -1
  }

  // Total fence count is even — search backward from end of NEW text only
  // for `\n\n` boundaries. We only need to search within the delta region
  // plus a small overlap (to catch \n\n that straddles the boundary).
  const searchStart = Math.max(0, state.scannedLength - delta.length - DOUBLE_NEWLINE_LENGTH)
  let pos = text.length
  while (pos > searchStart) {
    const idx = text.lastIndexOf('\n\n', pos - 1)
    if (idx === -1 || idx < searchStart) break

    // Fence count up to this candidate = total fences minus fences after candidate.
    // Since total is even AND we're searching backward, the last \n\n where
    // fences-before is even is our split point. Use cumulative count minus
    // fences in the suffix after the candidate.
    const fencesAfter = countCodeFences(text.slice(idx))
    const fencesBefore = state.fenceCount - fencesAfter
    if (fencesBefore % FENCE_PARITY_DIVISOR === 0) {
      state.lastSplitIdx = idx + DOUBLE_NEWLINE_LENGTH
      return state.lastSplitIdx
    }
    pos = idx
  }

  // No new valid split in the delta — preserve previous result
  if (state.lastSplitIdx > 0 && state.lastSplitIdx <= text.length) {
    return state.lastSplitIdx
  }
  return -1
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
  const splitStateRef = useRef<SplitScanState>({ ...INITIAL_SPLIT_STATE })

  // Invalidate prefix cache when highlighter changes (e.g., from undefined to loaded)
  const prevHighlighterRef = useRef(shikiOptions.highlighter)
  if (prevHighlighterRef.current !== shikiOptions.highlighter) {
    prevHighlighterRef.current = shikiOptions.highlighter
    prefixStateRef.current = null
  }

  if (!isStreaming) {
    // Clear incremental state so it doesn't hold stale data between messages
    if (splitStateRef.current.scannedLength > 0) {
      resetSplitState(splitStateRef.current)
      prefixStateRef.current = null
    }
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
