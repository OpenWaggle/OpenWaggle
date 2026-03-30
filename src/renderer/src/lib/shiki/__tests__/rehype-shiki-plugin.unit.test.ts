import type { Root } from 'hast'
import { createHighlighter, createJavaScriptRegexEngine } from 'shiki'
import { describe, expect, it } from 'vitest'
import { createRehypeShikiPlugin } from '../rehype-shiki-plugin'
import { ShikiCache } from '../shiki-cache'

/** Build a minimal HAST tree for `<pre><code class="language-{lang}">code</code></pre>`. */
function makeTree(language: string, code: string): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: [`language-${language}`] },
            children: [{ type: 'text', value: code }],
          },
        ],
      },
    ],
  }
}

/** Get the code element from a tree. */
function getCodeElement(tree: Root) {
  const pre = tree.children[0]
  if (pre.type !== 'element') throw new Error('Expected element')
  const code = pre.children[0]
  if (code.type !== 'element') throw new Error('Expected element')
  return code
}

async function loadHighlighter() {
  return createHighlighter({
    themes: ['github-dark'],
    langs: ['typescript', 'javascript'],
    engine: createJavaScriptRegexEngine(),
  })
}

/**
 * createRehypeShikiPlugin returns a unified attacher (outer function).
 * The attacher returns the transformer (inner function).
 * Call attacher() to get the transformer, then call transformer(tree).
 */
function runPlugin(options: Parameters<typeof createRehypeShikiPlugin>[0], tree: Root): void {
  const attacher = createRehypeShikiPlugin(options)
  const transformer = attacher()
  transformer(tree)
}

describe('createRehypeShikiPlugin', () => {
  it('is a no-op when highlighter is undefined', () => {
    const cache = new ShikiCache()
    const tree = makeTree('typescript', 'const x = 1')
    const original = JSON.stringify(tree)

    runPlugin({ highlighter: undefined, cache }, tree)

    expect(JSON.stringify(tree)).toBe(original)
  })

  it('highlights TypeScript code', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()
    const tree = makeTree('typescript', 'const x = 1')

    runPlugin({ highlighter, cache }, tree)

    const code = getCodeElement(tree)
    // Shiki wraps tokens in span.line > span[style]
    const firstChild = code.children[0]
    expect(firstChild).toMatchObject({
      type: 'element',
      tagName: 'span',
    })
  })

  it('falls back gracefully for unsupported language', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()
    const tree = makeTree('cobol', 'DISPLAY "HELLO"')
    const originalCode = 'DISPLAY "HELLO"'

    runPlugin({ highlighter, cache }, tree)

    // Code should remain unchanged (cobol is not preloaded)
    const code = getCodeElement(tree)
    expect(code.children[0]).toMatchObject({ type: 'text', value: originalCode })
  })

  it('populates cache when not streaming', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()
    const tree = makeTree('typescript', 'const x = 1')

    expect(cache.size).toBe(0)

    runPlugin({ highlighter, cache }, tree)

    expect(cache.size).toBe(1)
  })

  it('returns cached result on second render', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()

    // First render: populate cache
    const tree1 = makeTree('typescript', 'const x = 1')
    runPlugin({ highlighter, cache }, tree1)
    const firstResult = JSON.stringify(getCodeElement(tree1))

    // Second render: should hit cache and produce identical output
    const tree2 = makeTree('typescript', 'const x = 1')
    runPlugin({ highlighter, cache }, tree2)
    const secondResult = JSON.stringify(getCodeElement(tree2))

    expect(firstResult).toBe(secondResult)
    expect(cache.size).toBe(1)
  })

  it('caches highlights during streaming (content-addressed keys prevent staleness)', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()

    const tree = makeTree('typescript', 'const x = 1')
    runPlugin({ highlighter, cache }, tree)

    // Highlighting should happen
    const code = getCodeElement(tree)
    expect(code.children[0]).toMatchObject({ type: 'element', tagName: 'span' })

    // Cache should now contain the highlight (content-addressed key)
    expect(cache.size).toBe(1)
  })

  it('preserves language class after highlighting', async () => {
    const highlighter = await loadHighlighter()
    const cache = new ShikiCache()
    const tree = makeTree('typescript', 'const x = 1')

    runPlugin({ highlighter, cache }, tree)

    const code = getCodeElement(tree)
    const className = code.properties.className
    expect(Array.isArray(className)).toBe(true)
    if (Array.isArray(className)) {
      expect(className.some((c) => typeof c === 'string' && c.startsWith('language-'))).toBe(true)
    }
  })
})
