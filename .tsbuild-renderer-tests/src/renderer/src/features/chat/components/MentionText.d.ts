import type { ReactNode } from 'react';
/**
 * Splits text into an array of ReactNode items, replacing @path patterns
 * with inline file mention chips. Plain text segments are returned as strings.
 */
export declare function renderTextWithMentions(text: string): ReactNode[];
