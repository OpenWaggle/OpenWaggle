import type { Highlighter } from 'shiki';
import { type RehypePlugins } from '@/shared/lib/markdown-safety';
import type { ShikiCache } from '@/shared/lib/shiki/shiki-cache';
interface IncrementalMarkdownProps {
    text: string;
    isStreaming: boolean;
    highlighter: Highlighter | undefined;
    cache: ShikiCache;
    rehypePlugins: RehypePlugins;
    /** Lightweight plugins for the streaming tail (e.g. sanitize-only, no Shiki). */
    tailRehypePlugins?: RehypePlugins | undefined;
}
export declare function IncrementalMarkdown({ text, isStreaming, highlighter, cache, rehypePlugins, tailRehypePlugins, }: IncrementalMarkdownProps): import("node_modules/@types/react").JSX.Element;
export {};
