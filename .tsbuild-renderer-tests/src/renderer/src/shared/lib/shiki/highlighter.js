import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';
const PRELOADED_LANGUAGES = [
    'typescript',
    'javascript',
    'json',
    'bash',
    'python',
    'css',
    'html',
    'markdown',
    'yaml',
    'sql',
    'rust',
    'go',
];
const PRELOADED_THEMES = ['github-dark'];
let highlighterPromise;
export function getHighlighter() {
    if (highlighterPromise === undefined) {
        highlighterPromise = createHighlighter({
            themes: [...PRELOADED_THEMES],
            langs: [...PRELOADED_LANGUAGES],
            engine: createJavaScriptRegexEngine(),
        });
    }
    return highlighterPromise;
}
/** Set of languages available without dynamic loading. */
export const PRELOADED_LANGUAGE_SET = new Set(PRELOADED_LANGUAGES);
/** Map short aliases to their canonical language IDs (Shiki handles these, but our guard set doesn't). */
const LANGUAGE_ALIASES = new Map([
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['js', 'javascript'],
    ['jsx', 'javascript'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['zsh', 'bash'],
    ['yml', 'yaml'],
    ['md', 'markdown'],
    ['py', 'python'],
    ['rs', 'rust'],
    ['jsonc', 'json'],
]);
function isPreloadedLanguage(lang) {
    return PRELOADED_LANGUAGE_SET.has(lang);
}
/**
 * Resolve a language alias to its canonical preloaded name.
 * Returns the canonical name if the language (or its alias) is preloaded,
 * otherwise returns undefined.
 */
export function resolveLanguage(lang) {
    if (isPreloadedLanguage(lang))
        return lang;
    return LANGUAGE_ALIASES.get(lang);
}
/** Default theme used for highlighting. */
export const DEFAULT_THEME = PRELOADED_THEMES[0];
