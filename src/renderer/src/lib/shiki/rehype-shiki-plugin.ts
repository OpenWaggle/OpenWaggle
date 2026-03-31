/**
 * Rehype plugin that highlights fenced code blocks using Shiki.
 *
 * Replaces the children of `<code class="language-*">` elements inside
 * `<pre>` with Shiki-highlighted HAST nodes. The ShikiCache is content-addressed
 * (keyed on language + code text), so it is safe to read/write during streaming.
 */
import type { Element, ElementContent, Properties, Root, RootContent } from 'hast'
import type { Highlighter } from 'shiki'
import { DEFAULT_THEME, resolveLanguage } from './highlighter'
import type { ShikiCache } from './shiki-cache'

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------
export interface RehypeShikiOptions {
  /** Resolved highlighter instance. `undefined` → plugin is a no-op. */
  highlighter: Highlighter | undefined
  /** LRU cache for highlights (content-addressed, safe during streaming). */
  cache: ShikiCache
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGUAGE_CLASS_RE = /^language-(.+)$/

/** Extract the language identifier from a `className` property array. */
function extractLanguageFromClass(properties: Properties): string | undefined {
  const raw = properties.className
  if (!Array.isArray(raw)) return undefined
  for (const cls of raw) {
    if (typeof cls !== 'string') continue
    const match = LANGUAGE_CLASS_RE.exec(cls)
    if (match) return match[1]
  }
  return undefined
}

/** Recursively extract plain-text content from HAST nodes. */
function textContent(node: RootContent | ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textContent).join('')
  return ''
}

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === 'element'
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Returns a unified-compatible rehype plugin (attacher → transformer) that
 * highlights fenced code blocks with Shiki. The returned function is stateless
 * and safe to recreate on every render. Unified calls the outer function as an
 * attacher; the returned inner function is the transformer.
 */
export function createRehypeShikiPlugin(options: RehypeShikiOptions) {
  const { highlighter, cache } = options

  // Return a unified attacher — unified calls this, it returns the transformer
  return function rehypeShikiAttacher() {
    return function rehypeShikiTransformer(tree: Root): void {
      if (highlighter === undefined) return
      if (!tree || !Array.isArray(tree.children)) return
      visitPreElements(tree.children, highlighter, cache)
    }
  }
}

/** Walk the tree and process `<pre><code class="language-*">` pairs. */
function visitPreElements(
  children: Array<RootContent | ElementContent>,
  highlighter: Highlighter,
  cache: ShikiCache,
): void {
  for (const child of children) {
    if (!isElement(child)) continue

    if (child.tagName === 'pre') {
      processPreElement(child, highlighter, cache)
      continue
    }

    visitPreElements(child.children, highlighter, cache)
  }
}

/** Process a single `<pre>` element: find its `<code>` child and highlight. */
function processPreElement(pre: Element, highlighter: Highlighter, cache: ShikiCache): void {
  const codeNode = pre.children.find((c): c is Element => isElement(c) && c.tagName === 'code')
  if (!codeNode) return

  const rawLang = extractLanguageFromClass(codeNode.properties)
  const language = rawLang ? resolveLanguage(rawLang) : undefined
  if (!language) return

  const code = textContent(codeNode)
  if (!code) return

  // --- Cache path (content-addressed, safe during streaming) ---
  // ShikiCache keys on cyrb53(language + '\0' + code). Growing code produces
  // new keys automatically, so there is no risk of returning stale highlights.
  const cached = cache.get(language, code)
  if (cached) {
    codeNode.children = [...cached.children]
    codeNode.properties = { ...cached.properties, ...preserveLanguageClass(codeNode) }
    return
  }

  // --- Highlight ---
  const highlighted = highlightCode(highlighter, code, language)
  if (!highlighted) return

  // Apply highlighted children to the original code element
  codeNode.children = [...highlighted.children]
  codeNode.properties = { ...highlighted.properties, ...preserveLanguageClass(codeNode) }

  cache.set(language, code, highlighted)
}

/** Preserve the language-* class on the code element for downstream use. */
function preserveLanguageClass(codeNode: Element): Properties {
  const lang = extractLanguageFromClass(codeNode.properties)
  if (lang) return { className: [`language-${lang}`] }
  return {}
}

/**
 * Apply Shiki highlighting directly to an existing HAST tree.
 *
 * Walks `<pre><code class="language-*">` pairs and replaces their children
 * with highlighted tokens — the same transform the rehype plugin performs,
 * but callable outside the unified pipeline (e.g. on a pre-parsed prefix tree).
 */
export function applyShikiToHast(tree: Root, options: RehypeShikiOptions): void {
  const { highlighter, cache } = options
  if (highlighter === undefined) return
  visitPreElements(tree.children, highlighter, cache)
}

/**
 * Call Shiki's `codeToHast` and extract the `<code>` element from the result.
 * Returns undefined if highlighting fails.
 */
function highlightCode(
  highlighter: Highlighter,
  code: string,
  language: string,
): Element | undefined {
  try {
    const root = highlighter.codeToHast(code, { lang: language, theme: DEFAULT_THEME })

    // Shiki output: root > pre.shiki > code > span.line*
    const preEl = root.children.find((c): c is Element => isElement(c) && c.tagName === 'pre')
    if (!preEl) return undefined

    const codeEl = preEl.children.find((c): c is Element => isElement(c) && c.tagName === 'code')
    return codeEl
  } catch {
    return undefined
  }
}
