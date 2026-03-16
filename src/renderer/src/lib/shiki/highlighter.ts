/**
 * Singleton Shiki highlighter with lazy initialization.
 *
 * Pre-loads 12 common language grammars on first access.
 * Uses the JavaScript regex engine (no WASM needed).
 */
import type { Highlighter } from 'shiki'
import { createHighlighter, createJavaScriptRegexEngine } from 'shiki'

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
] as const

const PRELOADED_THEMES = ['github-dark'] as const

let highlighterPromise: Promise<Highlighter> | undefined

export function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === undefined) {
    highlighterPromise = createHighlighter({
      themes: [...PRELOADED_THEMES],
      langs: [...PRELOADED_LANGUAGES],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

/** Set of languages available without dynamic loading. */
export const PRELOADED_LANGUAGE_SET: ReadonlySet<string> = new Set<string>(PRELOADED_LANGUAGES)

/** Map short aliases to their canonical language IDs (Shiki handles these, but our guard set doesn't). */
const LANGUAGE_ALIASES: ReadonlyMap<string, string> = new Map([
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
])

/**
 * Resolve a language alias to its canonical preloaded name.
 * Returns the canonical name if the language (or its alias) is preloaded,
 * otherwise returns undefined.
 */
export function resolveLanguage(lang: string): string | undefined {
  if (PRELOADED_LANGUAGE_SET.has(lang)) return lang
  const canonical = LANGUAGE_ALIASES.get(lang)
  if (canonical && PRELOADED_LANGUAGE_SET.has(canonical)) return canonical
  return undefined
}

/** Default theme used for highlighting. */
export const DEFAULT_THEME = PRELOADED_THEMES[0]
