/**
 * Rehype plugin that highlights fenced code blocks using Shiki.
 *
 * Replaces the children of `<code class="language-*">` elements inside
 * `<pre>` with Shiki-highlighted HAST nodes. The ShikiCache is content-addressed
 * (keyed on language + code text), so it is safe to read/write during streaming.
 */
import type { Root } from 'hast';
import type { Highlighter } from 'shiki';
import type { ShikiCache } from './shiki-cache';
export interface RehypeShikiOptions {
    /** Resolved highlighter instance. `undefined` → plugin is a no-op. */
    highlighter: Highlighter | undefined;
    /** LRU cache for highlights (content-addressed, safe during streaming). */
    cache: ShikiCache;
}
/**
 * Returns a unified-compatible rehype plugin (attacher → transformer) that
 * highlights fenced code blocks with Shiki. The returned function is stateless
 * and safe to recreate on every render. Unified calls the outer function as an
 * attacher; the returned inner function is the transformer.
 */
export declare function createRehypeShikiPlugin(options: RehypeShikiOptions): () => (tree: Root) => void;
/**
 * Apply Shiki highlighting directly to an existing HAST tree.
 *
 * Walks `<pre><code class="language-*">` pairs and replaces their children
 * with highlighted tokens — the same transform the rehype plugin performs,
 * but callable outside the unified pipeline (e.g. on a pre-parsed prefix tree).
 */
export declare function applyShikiToHast(tree: Root, options: RehypeShikiOptions): void;
