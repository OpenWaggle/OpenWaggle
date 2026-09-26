import { existsSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ProductDemo from '../ProductDemo.astro';

describe('product demo', () => {
  it('uses a labelled native radio group and three real screenshots', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    expect(html).toContain('<fieldset');
    expect(html).toContain('Explore OpenWaggle');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/ checked/g)).toHaveLength(1);
    expect(html).toContain('id="view-conversation"');
    expect(html).toContain('id="view-changes"');
    expect(html).toContain('id="view-browser"');
    expect(html).toContain('/screenshots/feature-coding-agent.png');
    expect(html).toContain('/screenshots/feature-git-workflow.png');
    expect(html).toContain('/screenshots/feature-browser-preview.png');
    expect(html).not.toContain('Browser capture pending');
    expect(existsSync(new URL('../../../../public/screenshots/feature-browser-preview.png', import.meta.url))).toBe(true);
  });

  it('keeps each description outside the bordered screenshot frame', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    const figures = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/g)];

    expect(figures).toHaveLength(3);
    for (const [, figure] of figures) {
      expect(figure).toContain('class="demo-frame ');
      expect(figure).toMatch(/<img\b[^>]*>\s*<\/div>\s*<figcaption\b/);
      expect(figure).not.toMatch(/<figcaption[^>]*border-/);
    }
  });
});
