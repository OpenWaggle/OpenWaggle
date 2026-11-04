import { readFileSync } from 'node:fs';
import { unified } from '@astrojs/markdown-remark';
import { describe, expect, it } from 'vitest';
import { rehypeZoomableImages } from '../markdown-images';

async function render(markdown: string) {
  const processor = await unified({ rehypePlugins: [rehypeZoomableImages] }).createRenderer({ syntaxHighlight: 'shiki' });
  return (await processor.render(markdown)).code;
}

describe('zoomable doc images', () => {
  it('links each image to its full-size file with an accessible name', async () => {
    const html = await render('![The Hive panel with two Workers](/screenshots/hive-sessions.png)');
    expect(html).toBe(
      '<p><a href="/screenshots/hive-sessions.png" class="docs-image-link">' +
        '<img src="/screenshots/hive-sessions.png" alt="The Hive panel with two Workers">' +
        '<span class="docs-visually-hidden"> (open full size)</span></a></p>',
    );
  });

  it('leaves an image that is already a link alone', async () => {
    const html = await render('[![Logo](/logo.png)](https://openwaggle.ai/)');
    expect(html).toBe('<p><a href="https://openwaggle.ai/"><img src="/logo.png" alt="Logo"></a></p>');
  });

  it('stays wired into the Astro Markdown pipeline', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/rehypePlugins: \[[\s\S]*\brehypeZoomableImages\b[\s\S]*\]/u);
  });
});
