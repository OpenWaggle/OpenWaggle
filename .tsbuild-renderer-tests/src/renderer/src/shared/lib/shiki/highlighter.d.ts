/**
 * Singleton Shiki highlighter with lazy initialization.
 *
 * Pre-loads 12 common language grammars on first access.
 * Uses the JavaScript regex engine (no WASM needed).
 */
import type { Highlighter } from 'shiki';
declare const PRELOADED_LANGUAGES: readonly ["typescript", "javascript", "json", "bash", "python", "css", "html", "markdown", "yaml", "sql", "rust", "go"];
export type PreloadedLanguage = (typeof PRELOADED_LANGUAGES)[number];
export declare function getHighlighter(): Promise<Highlighter>;
/** Set of languages available without dynamic loading. */
export declare const PRELOADED_LANGUAGE_SET: ReadonlySet<string>;
/**
 * Resolve a language alias to its canonical preloaded name.
 * Returns the canonical name if the language (or its alias) is preloaded,
 * otherwise returns undefined.
 */
export declare function resolveLanguage(lang: string): PreloadedLanguage | undefined;
/** Default theme used for highlighting. */
export declare const DEFAULT_THEME: "github-dark";
export {};
