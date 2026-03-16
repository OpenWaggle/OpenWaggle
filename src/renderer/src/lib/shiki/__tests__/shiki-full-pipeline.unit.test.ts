import type { Element, Root } from 'hast'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { createHighlighter, createJavaScriptRegexEngine } from 'shiki'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { safeMarkdownSanitizeSchema } from '../../markdown-safety'
import { createRehypeShikiPlugin } from '../rehype-shiki-plugin'
import { ShikiCache } from '../shiki-cache'

function collectStyles(
  node:
    | Root
    | Element
    | { type: string; properties?: Record<string, unknown>; children?: unknown[] },
): string[] {
  const styles: string[] = []
  if ('properties' in node && node.properties?.style) styles.push(String(node.properties.style))
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      styles.push(...collectStyles(child as Parameters<typeof collectStyles>[0]))
    }
  }
  return styles
}

describe('full pipeline: Shiki + rehypeSanitize preserves style attributes', () => {
  it('color: style values survive rehypeSanitize', async () => {
    const highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: ['typescript'],
      engine: createJavaScriptRegexEngine(),
    })
    const cache = new ShikiCache()
    const markdown = '```typescript\nconst x: number = 1\n```'

    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(createRehypeShikiPlugin({ highlighter, isStreaming: false, cache }))
      .use(rehypeSanitize, safeMarkdownSanitizeSchema)

    const mdast = processor.parse(markdown)
    const hast = await processor.run(mdast)

    const styles = collectStyles(hast)
    expect(
      styles.length,
      'Expected Shiki to produce inline style attributes that survive sanitize',
    ).toBeGreaterThan(0)
    expect(
      styles.some((s) => s.includes('color:')),
      'Expected color: values in style attributes',
    ).toBe(true)
  })
})
