import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import MakeItYours from '../MakeItYours.astro';

describe('make it yours section', () => {
  it('links to both extension guides', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MakeItYours);
    expect(html).toContain('aria-labelledby="make-it-yours-heading"');
    expect(html).toContain('href="/docs/extending/plugins/"');
    expect(html).toContain('href="/docs/extending/openwaggle-extensions/"');
  });
});
