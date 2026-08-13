/**
 * LRU cache for Shiki-highlighted HAST nodes.
 *
 * Stores pre-highlighted `<code>` Element nodes keyed by a fast hash of
 * (language + code). Uses Map insertion-order semantics for O(1) LRU eviction.
 */
import type { Element } from 'hast';
export declare class ShikiCache {
    private readonly map;
    private readonly maxEntries;
    constructor(maxEntries?: number);
    get(language: string, code: string): Element | undefined;
    set(language: string, code: string, element: Element): void;
    clear(): void;
    get size(): number;
}
