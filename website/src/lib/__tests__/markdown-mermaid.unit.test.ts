import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unified } from '@astrojs/markdown-remark'
import { describe, expect, it } from 'vitest'
import { remarkMermaidDiagrams, renderMermaidFigure } from '../markdown-mermaid'

const PAGE = [
  '# Diagram',
  '',
  'A Queen with two Workers:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A["Queen Session"] --> B["Worker Session"]',
  '  A --> C["Worker Session"]',
  '```',
  '',
  '```mermaid',
  '%% alt: Submitted, then accepted',
  'stateDiagram-v2',
  '  [*] --> submitted',
  '  submitted --> accepted',
  '```',
  '',
  '```ts',
  'const answer = 42;',
  '```',
].join('\n')

async function render(markdown: string, fileURL = new URL('file:///docs/example.md')) {
  // Shiki is Astro's default highlighter; the plugin has to take the block before it does.
  const processor = await unified({ remarkPlugins: [remarkMermaidDiagrams] }).createRenderer({
    syntaxHighlight: 'shiki',
  })
  return (await processor.render(markdown, { fileURL })).code
}

const FIGURE = /<figure class="mermaid-diagram">[\s\S]*?<\/figure>/gu

describe('mermaid diagrams', () => {
  it('turns a mermaid block into a diagram figure instead of a Shiki code block', async () => {
    const html = await render(PAGE)
    const figures = html.match(FIGURE) ?? []
    expect(figures).toHaveLength(2)
    expect(figures[0]).toMatch(/<svg class="mermaid-svg"[^>]*viewBox="/u)
    expect(figures[0]).toContain('>Queen Session</text>')
    expect(html).not.toMatch(/<pre[^>]*data-language="mermaid"/u)
    expect(html).not.toContain('language-mermaid')
    // Other languages are still highlighted.
    expect(html).toMatch(/<pre class="astro-code[^"]*"[^>]*data-language="ts"/u)
  })

  it('names each diagram for screen readers, from its lead-in or its alt line', async () => {
    const [first = '', second = ''] = (await render(PAGE)).match(FIGURE) ?? []
    expect(first).toMatch(
      /<svg class="mermaid-svg" role="img" aria-label="A Queen with two Workers"/u,
    )
    expect(second).toMatch(
      /<svg class="mermaid-svg" role="img" aria-label="Submitted, then accepted"/u,
    )
    // The alt line names the diagram; it is not part of the source shown beside it.
    expect(second).not.toContain('%% alt')
  })

  it('escapes the accessible name', () => {
    const figure = renderMermaidFigure(
      'flowchart TD\n  A --> B',
      'mermaid-1',
      'A "quoted" <b>name</b>',
    )
    expect(figure).toContain('aria-label="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt;"')
  })

  it('fails the build for a diagram with nothing to name it', async () => {
    await expect(render('# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```')).rejects.toThrow(
      /Mermaid diagram 1 in \/docs\/example\.md failed to render: Introduce the diagram with a paragraph/u,
    )
  })

  it.each([
    'stateDiagram-v2\n  [*] --> working\n  note right of working: Not drawn',
    'sequenceDiagram\n  A->>B: Hi\n  Note over A,B: Not drawn',
  ])('fails the build for a note, which beautiful-mermaid would drop: %s', (source) => {
    expect(() => renderMermaidFigure(source, 'mermaid-1', 'Example')).toThrow(/`note` line/u)
  })

  it('keeps the source as readable text next to the diagram', async () => {
    const html = await render(PAGE)
    expect(html).toContain('<summary>Diagram source</summary>')
    expect(html).toContain('<pre>flowchart LR\n  A["Queen Session"] --> B["Worker Session"]')
  })

  it('gives each diagram on a page its own marker ids', async () => {
    const html = await render(PAGE)
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(([, id]) => id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    expect(html).toContain('marker-end="url(#mermaid-1-arrowhead)"')
    expect(html).toContain('marker-end="url(#mermaid-2-arrowhead)"')
  })

  it('loads nothing from outside the site and carries no unscoped styles', () => {
    const figure = renderMermaidFigure('flowchart TD\n  A --> B', 'mermaid-1', 'Example')
    expect(figure).not.toContain('<style')
    expect(figure).not.toContain('googleapis')
    expect(figure).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org\/2000\/svg)/u)
  })

  it('fails the build with the page path when a diagram cannot be parsed', async () => {
    await expect(render('Broken:\n\n```mermaid\nnot a diagram\n```')).rejects.toThrow(
      /Mermaid diagram 1 in \/docs\/example\.md/u,
    )
  })

  it('stays wired into the Astro Markdown pipeline', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8')
    expect(config).toMatch(/remarkPlugins: \[[^\]]*\bremarkMermaidDiagrams\b[^\]]*\]/u)
  })

  const BUILT_PAGE = new URL(
    '../../../dist/docs/extending/openwaggle-extensions/index.html',
    import.meta.url,
  )
  // Checks the built site, so it runs after `bun run website:build`, as the website rehearsal does.
  it.skipIf(!existsSync(BUILT_PAGE))(
    'renders the extension docs diagrams in the built site',
    () => {
      const page = readFileSync(BUILT_PAGE, 'utf8')
      expect(page.match(/<figure class="mermaid-diagram">/gu)?.length).toBeGreaterThanOrEqual(2)
      expect(page).not.toContain('data-language="mermaid"')
    },
  )
})

// Every ```mermaid block in the docs, rendered as the site build renders it, so a diagram that does
// not parse fails the unit tests on the pull request instead of the deploy.
const DOCS_ROOT = fileURLToPath(new URL('../../content/docs/', import.meta.url))
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/u
const MERMAID_FENCE = /^```mermaid\b/gmu
const DOCS_WITH_DIAGRAMS = readdirSync(DOCS_ROOT, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.md'))
  .map((file) => ({ file, markdown: readFileSync(join(DOCS_ROOT, file), 'utf8') }))
  .map(({ file, markdown }) => ({ file, markdown: markdown.replace(FRONTMATTER, '') }))
  .filter(({ markdown }) => (markdown.match(MERMAID_FENCE)?.length ?? 0) > 0)

describe('the diagrams in the docs', () => {
  it('exist', () => {
    expect(DOCS_WITH_DIAGRAMS.length).toBeGreaterThan(0)
  })

  it.each(DOCS_WITH_DIAGRAMS)(
    'render in $file, each with an accessible name',
    async ({ file, markdown }) => {
      const html = await render(markdown, new URL(`file:///docs/${file}`))
      const figures = html.match(FIGURE) ?? []
      expect(figures).toHaveLength(markdown.match(MERMAID_FENCE)?.length ?? 0)
      for (const figure of figures) {
        expect(figure).toMatch(/<svg class="mermaid-svg" role="img" aria-label="[^"]+"/u)
      }
      expect(html).not.toContain('data-language="mermaid"')
    },
  )
})
