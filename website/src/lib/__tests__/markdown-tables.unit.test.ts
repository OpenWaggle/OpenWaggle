import { readFileSync } from 'node:fs';
import { unified } from '@astrojs/markdown-remark';
import { describe, expect, it } from 'vitest';
import { rehypeScrollableTables } from '../markdown-tables';

async function render(markdown: string) {
  const processor = await unified({ rehypePlugins: [rehypeScrollableTables] }).createRenderer({ syntaxHighlight: 'shiki' });
  return (await processor.render(markdown)).code;
}

describe('scrollable doc tables', () => {
  it('wraps a table in a scroll box that keyboard users can focus', async () => {
    const html = await render('| Action | Meaning |\n| --- | --- |\n| Interrupt | Stop the run. |');
    expect(html).toMatch(/^<div class="docs-table-scroll" tabindex="0">\s*<table>/u);
    expect(html.endsWith('</table></div>')).toBe(true);
  });

  it('keeps words whole in table cells, which overflow-wrap: anywhere on the page would break', () => {
    const css = readFileSync(new URL('../../styles/prose.css', import.meta.url), 'utf8');
    const tableRule = /\.prose-docs table \{[^}]*\}/u.exec(css)?.[0] ?? '';
    expect(tableRule).toContain('overflow-wrap: normal');
    expect(css).toMatch(/\.prose-docs \.docs-table-scroll \{[^}]*overflow-x: auto/u);
  });

  it('is registered in the Astro Markdown pipeline', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8');
    expect(config).toContain('rehypeScrollableTables');
  });
});
