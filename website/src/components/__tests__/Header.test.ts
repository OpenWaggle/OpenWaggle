import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Header from '../Header.astro';

describe('site header', () => {
  it('points both Download links at the installation guide', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Header, { request: new Request('https://openwaggle.ai/') });
    const downloads = [...html.matchAll(/<a\b[^>]*>Download<\/a>/g)].map(([link]) => link);
    expect(downloads).toHaveLength(2);
    for (const link of downloads) expect(link).toContain('href="/docs/getting-started/installation/"');
  });
});
