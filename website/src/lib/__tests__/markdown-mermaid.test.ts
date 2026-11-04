import { existsSync, readFileSync } from 'node:fs';
import { unified } from '@astrojs/markdown-remark';
import { describe, expect, it } from 'vitest';
import { remarkMermaidDiagrams, renderMermaidFigure } from '../markdown-mermaid';

const PAGE = [
  '# Diagram',
  '',
  '```mermaid',
  'flowchart LR',
  '  A["Queen Session"] --> B["Worker Session"]',
  '  A --> C["Worker Session"]',
  '```',
  '',
  '```mermaid',
  'stateDiagram-v2',
  '  [*] --> submitted',
  '  submitted --> accepted',
  '```',
  '',
  '```ts',
  'const answer = 42;',
  '```',
].join('\n');

async function render(markdown: string) {
  // Shiki is Astro's default highlighter; the plugin has to take the block before it does.
  const processor = await unified({ remarkPlugins: [remarkMermaidDiagrams] }).createRenderer({ syntaxHighlight: 'shiki' });
  return (await processor.render(markdown, { fileURL: new URL('file:///docs/example.md') })).code;
}

describe('mermaid diagrams', () => {
  it('turns a mermaid block into a diagram figure instead of a Shiki code block', async () => {
    const html = await render(PAGE);
    const figures = html.match(/<figure class="mermaid-diagram">[\s\S]*?<\/figure>/gu) ?? [];
    expect(figures).toHaveLength(2);
    expect(figures[0]).toMatch(/<svg class="mermaid-svg"[^>]*viewBox="/u);
    expect(figures[0]).toContain('>Queen Session</text>');
    expect(html).not.toMatch(/<pre[^>]*data-language="mermaid"/u);
    expect(html).not.toContain('language-mermaid');
    // Other languages are still highlighted.
    expect(html).toMatch(/<pre class="astro-code[^"]*"[^>]*data-language="ts"/u);
  });

  it('keeps the source as readable text next to the diagram', async () => {
    const html = await render(PAGE);
    expect(html).toContain('<summary>Diagram source</summary>');
    expect(html).toContain('<pre>flowchart LR\n  A["Queen Session"] --> B["Worker Session"]');
  });

  it('gives each diagram on a page its own marker ids', async () => {
    const html = await render(PAGE);
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(([, id]) => id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('marker-end="url(#mermaid-1-arrowhead)"');
    expect(html).toContain('marker-end="url(#mermaid-2-arrowhead)"');
  });

  it('loads nothing from outside the site and carries no unscoped styles', () => {
    const figure = renderMermaidFigure('flowchart TD\n  A --> B', 'mermaid-1');
    expect(figure).not.toContain('<style');
    expect(figure).not.toContain('googleapis');
    expect(figure).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org\/2000\/svg)/u);
  });

  it('fails the build with the page path when a diagram cannot be parsed', async () => {
    await expect(render('```mermaid\nnot a diagram\n```')).rejects.toThrow(/Mermaid diagram 1 in \/docs\/example\.md/u);
  });

  it('stays wired into the Astro Markdown pipeline', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/remarkPlugins: \[[^\]]*\bremarkMermaidDiagrams\b[^\]]*\]/u);
  });

  const BUILT_PAGE = new URL('../../../dist/docs/extending/openwaggle-extensions/index.html', import.meta.url);
  it.skipIf(!existsSync(BUILT_PAGE))('renders the extension docs diagrams in the built site', () => {
    const page = readFileSync(BUILT_PAGE, 'utf8');
    expect(page.match(/<figure class="mermaid-diagram">/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(page).not.toContain('data-language="mermaid"');
  });
});
