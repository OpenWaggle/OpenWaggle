import { existsSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ProductDemo from '../ProductDemo.astro';

const VIEWS = ['hive', 'waggle', 'conversation', 'changes', 'browser'];
const SCREENSHOTS = [
  'hive-sessions.png',
  'session-tree-panel.png',
  'feature-coding-agent.png',
  'feature-git-workflow.png',
  'feature-browser-preview.png',
];

describe('product demo', () => {
  it('uses a labelled native radio group with the multi-agent views first', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    expect(html).toContain('<fieldset');
    expect(html).toContain('Explore OpenWaggle');
    expect(html.match(/type="radio"/g)).toHaveLength(VIEWS.length);
    expect(html.match(/ checked/g)).toHaveLength(1);
    expect(html).toMatch(/id="view-hive"[^>]* checked/);
    const order = VIEWS.map((view) => html.indexOf(`id="view-${view}"`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('Multiple agents');
    expect(html).toContain('Every session');
  });

  it('shows a real screenshot for every view', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    for (const screenshot of SCREENSHOTS) {
      expect(html).toContain(`/screenshots/${screenshot}`);
      expect(existsSync(new URL(`../../../../public/screenshots/${screenshot}`, import.meta.url))).toBe(true);
    }
  });

  it('keeps the default view visible and reveals the others through their radio', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    expect(html).toMatch(/id="demo-hive" class="[^"]*demo-default/);
    expect(html).toContain('.product-demo:has(input:checked:not(#view-hive)) #demo-hive { display: none; }');
    for (const view of VIEWS.slice(1)) {
      expect(html).toContain(`.product-demo:has(#view-${view}:checked) #demo-${view} { display: block; }`);
    }
  });

  it('keeps each description outside the bordered screenshot frame', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductDemo);
    const figures = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/g)];

    expect(figures).toHaveLength(VIEWS.length);
    for (const [, figure] of figures) {
      expect(figure).toContain('class="demo-frame ');
      expect(figure).toMatch(/<img\b[^>]*>\s*<\/div>\s*<figcaption\b/);
      expect(figure).not.toMatch(/<figcaption[^>]*border-/);
    }
  });
});
