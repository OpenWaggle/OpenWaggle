import type { Root } from 'hast'
import { useEffect, useRef } from 'react'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety'

/** Unified processor that parses markdown → HAST and sanitizes. */
const prefixProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, safeMarkdownSanitizeSchema)

const FENCE_TRAILING_GROUP = 2

interface IncrementalMarkdownResult {
  prefixHast: Root | null
  tail: string
  prefixKey: string
}

/** Parse markdown text to sanitized HAST synchronously via unified. */
function parseToHast(markdown: string) {
  const mdast = prefixProcessor.parse(markdown)
  return prefixProcessor.runSync(mdast)
}

// ---------------------------------------------------------------------------
// Incremental split state — tracks scan progress to avoid O(n²) rescanning
// ---------------------------------------------------------------------------

interface SplitScanState {
  /** The exact string scanned previously. Kept by reference for append detection. */
  scannedText: string
  /** Absolute start of the partial line that has not received a newline yet. */
  processedLength: number
  /** CommonMark fenced-code delimiter currently open, if any. */
  fence: { readonly character: '`' | '~'; readonly length: number } | null
  /** Last valid split index found (or -1). */
  lastSplitIdx: number
}

interface FenceRun {
  readonly character: '`' | '~'
  readonly length: number
  readonly trailing: string
}

const INITIAL_SPLIT_STATE: SplitScanState = {
  scannedText: '',
  processedLength: 0,
  fence: null,
  lastSplitIdx: -1,
}

function preservedSplit(state: SplitScanState, text: string) {
  return state.lastSplitIdx > 0 && state.lastSplitIdx <= text.length ? state.lastSplitIdx : -1
}

function fenceRun(line: string): FenceRun | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
  if (!match?.[1]) return null
  const delimiter = match[1]
  const character = delimiter[0]
  if (character !== '`' && character !== '~') return null
  return {
    character,
    length: delimiter.length,
    trailing: match[FENCE_TRAILING_GROUP] ?? '',
  }
}

function scanAppendedLines(text: string, initial: SplitScanState): SplitScanState {
  let cursor = initial.processedLength
  let fence = initial.fence
  let lastSplitIdx = initial.lastSplitIdx
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    if (newline < 0) break
    const line = text.slice(cursor, newline).replace(/\r$/u, '')
    const delimiter = fenceRun(line)
    cursor = newline + 1
    if (fence) {
      if (
        delimiter?.character === fence.character &&
        delimiter.length >= fence.length &&
        delimiter.trailing.trim().length === 0
      ) {
        fence = null
      }
      continue
    }
    if (delimiter) {
      const validBacktickInfo = delimiter.character !== '`' || !delimiter.trailing.includes('`')
      if (validBacktickInfo) {
        fence = { character: delimiter.character, length: delimiter.length }
      }
      continue
    }
    if (line.length === 0) {
      lastSplitIdx = newline + 1
    }
  }
  return { scannedText: text, processedLength: cursor, fence, lastSplitIdx }
}

/** Return the last complete paragraph boundary outside a CommonMark fenced code block. */
export function findSplitIndex(text: string): number {
  return scanAppendedLines(text, INITIAL_SPLIT_STATE).lastSplitIdx
}

interface SplitScanResult {
  readonly splitIdx: number
  readonly next: SplitScanState
}

/**
 * Incrementally find the split index by only scanning new text.
 * Carries the active CommonMark fence state without re-scanning the entire
 * prefix. Falls back to a full scan on non-monotonic text changes.
 *
 * Pure: returns the next scan state instead of mutating it, so render stays
 * free of ref writes (react-doctor/no-ref-current-in-render). The caller
 * commits the returned state after render.
 *
 * Amortized O(delta) per call where delta = new tokens since last call.
 */
function scanSplitIndex(text: string, state: SplitScanState): SplitScanResult {
  if (text === state.scannedText) {
    return { splitIdx: preservedSplit(state, text), next: state }
  }

  const base = text.startsWith(state.scannedText) ? state : INITIAL_SPLIT_STATE
  const next = scanAppendedLines(text, base)
  return { splitIdx: preservedSplit(next, text), next }
}

// ---------------------------------------------------------------------------
// Incremental prefix state — avoids re-parsing entire prefix on growth
// ---------------------------------------------------------------------------

interface PrefixState {
  text: string
  hast: Root
}

interface ComputedMarkdown {
  readonly result: IncrementalMarkdownResult
  readonly nextPrefixState: PrefixState | null
  readonly nextSplitState: SplitScanState
}

interface ComputeInput {
  readonly text: string
  readonly isStreaming: boolean
  readonly prefixState: PrefixState | null
  readonly splitState: SplitScanState
}

/** Pure split/parse step: derives the result and the next cache state. */
function computeIncrementalMarkdown(input: ComputeInput): ComputedMarkdown {
  const { text, isStreaming, prefixState, splitState } = input

  if (!isStreaming) {
    // Clear incremental state so it doesn't hold stale data between messages
    const stale = splitState.processedLength > 0
    return {
      result: { prefixHast: null, tail: text, prefixKey: '' },
      nextPrefixState: stale ? null : prefixState,
      nextSplitState: stale ? { ...INITIAL_SPLIT_STATE } : splitState,
    }
  }

  const { splitIdx, next: nextSplitState } = scanSplitIndex(text, splitState)

  if (splitIdx === -1) {
    return {
      result: { prefixHast: null, tail: text, prefixKey: '' },
      nextPrefixState: prefixState,
      nextSplitState,
    }
  }

  const prefixText = text.slice(0, splitIdx)
  const tail = text.slice(splitIdx)

  // Same prefix as before — reuse the cached tree
  if (prefixState && prefixText === prefixState.text) {
    return {
      result: { prefixHast: prefixState.hast, tail, prefixKey: prefixText },
      nextPrefixState: prefixState,
      nextSplitState,
    }
  }

  // Incremental growth: prefix extends the previous prefix.
  // Create a NEW Root so React detects the prop change and re-renders PrefixView.
  // (Reusing the same reference would be treated as "unchanged" by React
  // Compiler auto-memoization and skip the re-render.)
  if (prefixState && prefixText.startsWith(prefixState.text)) {
    const newHast = parseToHast(prefixText.slice(prefixState.text.length))
    const combined: Root = {
      type: 'root',
      children: [...prefixState.hast.children, ...newHast.children],
    }
    return {
      result: { prefixHast: combined, tail, prefixKey: prefixText },
      nextPrefixState: { text: prefixText, hast: combined },
      nextSplitState,
    }
  }

  // Full re-parse (first time or non-monotonic change)
  const hast = parseToHast(prefixText)
  return {
    result: { prefixHast: hast, tail, prefixKey: prefixText },
    nextPrefixState: { text: prefixText, hast },
    nextSplitState,
  }
}

/**
 * Split streaming text into a stable parsed prefix (all complete paragraphs)
 * and a live tail (current in-progress paragraph). The prefix is parsed to HAST
 * once and incrementally extended; only the tail is re-parsed on each render.
 *
 * When `isStreaming` is false, no splitting occurs — returns the full text
 * as the tail for the standard ReactMarkdown path.
 *
 * The parse caches live in refs but are only READ during render; the new state
 * is committed in an effect. Render therefore stays pure, and a render that
 * React discards or replays can no longer pollute the cache.
 */
export function useIncrementalMarkdown(
  text: string,
  isStreaming: boolean,
): IncrementalMarkdownResult {
  const prefixStateRef = useRef<PrefixState | null>(null)
  const splitStateRef = useRef<SplitScanState>({ ...INITIAL_SPLIT_STATE })

  const computed = computeIncrementalMarkdown({
    text,
    isStreaming,
    prefixState: prefixStateRef.current,
    splitState: splitStateRef.current,
  })

  useEffect(() => {
    prefixStateRef.current = computed.nextPrefixState
    splitStateRef.current = computed.nextSplitState
  })

  return computed.result
}
