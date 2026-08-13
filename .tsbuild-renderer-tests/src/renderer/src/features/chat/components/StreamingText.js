import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/shared/lib/cn';
import { safeMarkdownSanitizeSchema } from '@/shared/lib/markdown-safety';
import { getHighlighter } from '@/shared/lib/shiki/highlighter';
import { createRehypeShikiPlugin } from '@/shared/lib/shiki/rehype-shiki-plugin';
import { ShikiCache } from '@/shared/lib/shiki/shiki-cache';
import { IncrementalMarkdown } from './IncrementalMarkdown';
/** Module-level cache shared by all StreamingText instances. */
const shikiCache = new ShikiCache();
/** Sanitize plugin tuple — never changes, hoisted to module scope. */
const SANITIZE_PLUGIN_TUPLE = [rehypeSanitize, safeMarkdownSanitizeSchema];
/**
 * Tail-only plugins for streaming: sanitize only, skip Shiki.
 * During streaming, code blocks in the tail change every token, causing 100%
 * Shiki cache miss rate (content-addressed keys). Deferring highlighting to
 * the prefix (on paragraph completion) avoids ~5-20ms/token of wasted work.
 */
const TAIL_STREAMING_PLUGINS = [SANITIZE_PLUGIN_TUPLE];
const NO_HIGHLIGHTER_PLUGINS = [
    createRehypeShikiPlugin({ highlighter: undefined, cache: shikiCache }),
    SANITIZE_PLUGIN_TUPLE,
];
const HIGHLIGHTER_PLUGIN_CACHE = new WeakMap();
/**
 * Module-level resolved highlighter.
 * Set once the singleton promise resolves; read synchronously on each render.
 */
let resolvedHighlighter;
/** Start loading eagerly at module evaluation time. */
const highlighterReady = getHighlighter().then((hl) => {
    resolvedHighlighter = hl;
    return hl;
});
/**
 * Hook that returns the Shiki highlighter once loaded.
 * Triggers a single re-render when the highlighter becomes available.
 */
function useShikiHighlighter() {
    const [hl, setHl] = useState(() => resolvedHighlighter);
    useEffect(() => {
        if (hl !== undefined)
            return;
        highlighterReady.then(setHl);
    }, [hl]);
    return hl;
}
function getRehypePlugins(highlighter) {
    if (!highlighter) {
        return NO_HIGHLIGHTER_PLUGINS;
    }
    const cachedPlugins = HIGHLIGHTER_PLUGIN_CACHE.get(highlighter);
    if (cachedPlugins) {
        return cachedPlugins;
    }
    const plugins = [
        createRehypeShikiPlugin({ highlighter, cache: shikiCache }),
        SANITIZE_PLUGIN_TUPLE,
    ];
    HIGHLIGHTER_PLUGIN_CACHE.set(highlighter, plugins);
    return plugins;
}
export function StreamingText({ text, isStreaming = false, className }) {
    const highlighter = useShikiHighlighter();
    if (!text)
        return null;
    const rehypePlugins = getRehypePlugins(highlighter);
    return (_jsx("div", { className: cn('prose', className), children: _jsx(IncrementalMarkdown, { text: text, isStreaming: isStreaming, highlighter: highlighter, cache: shikiCache, rehypePlugins: rehypePlugins, tailRehypePlugins: isStreaming ? TAIL_STREAMING_PLUGINS : undefined }) }));
}
