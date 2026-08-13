import type { Options as ReactMarkdownOptions, UrlTransform } from 'react-markdown';
import { type Options as SanitizeSchema } from 'rehype-sanitize';
export type RehypePlugins = NonNullable<ReactMarkdownOptions['rehypePlugins']>;
export declare function isAllowedMarkdownUrl(rawUrl: string): boolean;
export declare const safeMarkdownUrlTransform: UrlTransform;
export declare const safeMarkdownSanitizeSchema: SanitizeSchema;
/**
 * Default rehype plugins for non-streaming markdown (e.g. SkillsPanel).
 * Sanitize-only — Shiki highlighting is wired separately in StreamingText.
 */
export declare const safeMarkdownRehypePlugins: RehypePlugins;
