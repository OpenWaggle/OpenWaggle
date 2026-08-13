import { useEffect, useRef } from 'react';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety';
import { applyShikiToHast } from '@/shared/lib/shiki/rehype-shiki-plugin';
/** Unified processor that parses markdown → HAST and sanitizes. */
const prefixProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, safeMarkdownSanitizeSchema);
const CODE_FENCE_RE = /^`{3,}/gm;
const DOUBLE_NEWLINE_LENGTH = '\n\n'.length;
const FENCE_PARITY_DIVISOR = 2;
/**
 * Count opening/closing code fence markers (lines starting with 3+ backticks)
 * in the given text. An odd count means the text ends inside an open fence.
 */
function countCodeFences(text) {
    const matches = text.match(CODE_FENCE_RE);
    return matches ? matches.length : 0;
}
/**
 * Find the last `\n\n` boundary in `text` that is NOT inside a code fence.
 * Returns the index immediately after the `\n\n` (so prefix = text.slice(0, idx)
 * includes the trailing newlines), or -1 if no valid split point exists.
 */
export function findSplitIndex(text) {
    let pos = text.length;
    while (pos > 0) {
        const idx = text.lastIndexOf('\n\n', pos - 1);
        if (idx === -1)
            return -1;
        const before = text.slice(0, idx);
        if (countCodeFences(before) % FENCE_PARITY_DIVISOR === 0) {
            return idx + DOUBLE_NEWLINE_LENGTH;
        }
        pos = idx;
    }
    return -1;
}
/** Parse markdown text to sanitized HAST synchronously via unified. */
function parseToHast(markdown) {
    const mdast = prefixProcessor.parse(markdown);
    return prefixProcessor.runSync(mdast);
}
const INITIAL_SPLIT_STATE = { scannedLength: 0, fenceCount: 0, lastSplitIdx: -1 };
function preservedSplit(state, text) {
    return state.lastSplitIdx > 0 && state.lastSplitIdx <= text.length ? state.lastSplitIdx : -1;
}
/**
 * Incrementally find the split index by only scanning new text.
 * Uses cumulative fence count to determine parity without re-scanning the
 * entire prefix. Falls back to a full scan on non-monotonic text changes.
 *
 * Pure: returns the next scan state instead of mutating it, so render stays
 * free of ref writes (react-doctor/no-ref-current-in-render). The caller
 * commits the returned state after render.
 *
 * Amortized O(delta) per call where delta = new tokens since last call.
 */
function scanSplitIndex(text, state) {
    if (text.length <= state.scannedLength) {
        // Text shrunk or unchanged — full reset
        const lastSplitIdx = findSplitIndex(text);
        return {
            splitIdx: lastSplitIdx,
            next: { scannedLength: text.length, fenceCount: countCodeFences(text), lastSplitIdx },
        };
    }
    // Text grew — only scan the delta for fences
    const delta = text.slice(state.scannedLength);
    const fenceCount = state.fenceCount + countCodeFences(delta);
    const scannedLength = text.length;
    // If total fence count is odd, we're inside an open code block —
    // no valid split can exist beyond the last known one.
    if (fenceCount % FENCE_PARITY_DIVISOR !== 0) {
        return {
            splitIdx: preservedSplit(state, text),
            next: { scannedLength, fenceCount, lastSplitIdx: state.lastSplitIdx },
        };
    }
    // Total fence count is even — search backward from end of NEW text only
    // for `\n\n` boundaries. We only need to search within the delta region
    // plus a small overlap (to catch \n\n that straddles the boundary).
    const searchStart = Math.max(0, scannedLength - delta.length - DOUBLE_NEWLINE_LENGTH);
    let pos = text.length;
    while (pos > searchStart) {
        const idx = text.lastIndexOf('\n\n', pos - 1);
        if (idx === -1 || idx < searchStart)
            break;
        // Fence count up to this candidate = total fences minus fences after candidate.
        // Since total is even AND we're searching backward, the last `\n\n` where
        // fences-before is even is our split point.
        const fencesBefore = fenceCount - countCodeFences(text.slice(idx));
        if (fencesBefore % FENCE_PARITY_DIVISOR === 0) {
            const lastSplitIdx = idx + DOUBLE_NEWLINE_LENGTH;
            return { splitIdx: lastSplitIdx, next: { scannedLength, fenceCount, lastSplitIdx } };
        }
        pos = idx;
    }
    // No new valid split in the delta — preserve previous result
    return {
        splitIdx: preservedSplit(state, text),
        next: { scannedLength, fenceCount, lastSplitIdx: state.lastSplitIdx },
    };
}
/** Pure split/parse step: derives the result and the next cache state. */
function computeIncrementalMarkdown(input) {
    const { text, isStreaming, shikiOptions, prefixState, splitState } = input;
    if (!isStreaming) {
        // Clear incremental state so it doesn't hold stale data between messages
        const stale = splitState.scannedLength > 0;
        return {
            result: { prefixHast: null, tail: text, prefixKey: '' },
            nextPrefixState: stale ? null : prefixState,
            nextSplitState: stale ? { ...INITIAL_SPLIT_STATE } : splitState,
        };
    }
    const { splitIdx, next: nextSplitState } = scanSplitIndex(text, splitState);
    if (splitIdx === -1) {
        return {
            result: { prefixHast: null, tail: text, prefixKey: '' },
            nextPrefixState: prefixState,
            nextSplitState,
        };
    }
    const prefixText = text.slice(0, splitIdx);
    const tail = text.slice(splitIdx);
    // Same prefix as before — reuse the cached tree
    if (prefixState && prefixText === prefixState.text) {
        return {
            result: { prefixHast: prefixState.hast, tail, prefixKey: prefixText },
            nextPrefixState: prefixState,
            nextSplitState,
        };
    }
    // Incremental growth: prefix extends the previous prefix.
    // Create a NEW Root so React detects the prop change and re-renders PrefixView.
    // (Reusing the same reference would be treated as "unchanged" by React
    // Compiler auto-memoization and skip the re-render.)
    if (prefixState && prefixText.startsWith(prefixState.text)) {
        const newHast = parseToHast(prefixText.slice(prefixState.text.length));
        applyShikiToHast(newHast, {
            highlighter: shikiOptions.highlighter,
            cache: shikiOptions.cache,
        });
        const combined = {
            type: 'root',
            children: [...prefixState.hast.children, ...newHast.children],
        };
        return {
            result: { prefixHast: combined, tail, prefixKey: prefixText },
            nextPrefixState: { text: prefixText, hast: combined },
            nextSplitState,
        };
    }
    // Full re-parse (first time or non-monotonic change)
    // INVARIANT: `applyShikiToHast` mutates the tree. The mutated tree is stored
    // as the prefix state and never passed back through `applyShikiToHast` again —
    // same-prefix checks return early above, before reaching this block.
    const hast = parseToHast(prefixText);
    applyShikiToHast(hast, {
        highlighter: shikiOptions.highlighter,
        cache: shikiOptions.cache,
    });
    return {
        result: { prefixHast: hast, tail, prefixKey: prefixText },
        nextPrefixState: { text: prefixText, hast },
        nextSplitState,
    };
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
export function useIncrementalMarkdown(text, isStreaming, shikiOptions) {
    const prefixStateRef = useRef(null);
    const splitStateRef = useRef({ ...INITIAL_SPLIT_STATE });
    const highlighterRef = useRef(shikiOptions.highlighter);
    const computed = computeIncrementalMarkdown({
        text,
        isStreaming,
        shikiOptions,
        // A highlighter change (e.g. undefined -> loaded) invalidates the prefix cache.
        prefixState: highlighterRef.current === shikiOptions.highlighter ? prefixStateRef.current : null,
        splitState: splitStateRef.current,
    });
    useEffect(() => {
        highlighterRef.current = shikiOptions.highlighter;
        prefixStateRef.current = computed.nextPrefixState;
        splitStateRef.current = computed.nextSplitState;
    });
    return computed.result;
}
