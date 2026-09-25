import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ProductDemo from '../ProductDemo.astro';

describe('product demo', () => {
  it('uses a labelled native radio group and identifies the missing browser capture', async () => {
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
    expect(html).toContain('Browser capture pending');
    expect(html).toContain('href="/docs/developer-workflow/browser-preview"');
  });
});
