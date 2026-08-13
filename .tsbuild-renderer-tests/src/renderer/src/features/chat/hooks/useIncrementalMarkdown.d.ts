import type { Root } from 'hast';
import type { Highlighter } from 'shiki';
import type { ShikiCache } from '@/shared/lib/shiki/shiki-cache';
interface IncrementalMarkdownResult {
    prefixHast: Root | null;
    tail: string;
    prefixKey: string;
}
interface ShikiOptions {
    highlighter: Highlighter | undefined;
    cache: ShikiCache;
}
/**
 * Find the last `\n\n` boundary in `text` that is NOT inside a code fence.
 * Returns the index immediately after the `\n\n` (so prefix = text.slice(0, idx)
 * includes the trailing newlines), or -1 if no valid split point exists.
 */
export declare function findSplitIndex(text: string): number;
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
export declare function useIncrementalMarkdown(text: string, isStreaming: boolean, shikiOptions: ShikiOptions): IncrementalMarkdownResult;
export {};
