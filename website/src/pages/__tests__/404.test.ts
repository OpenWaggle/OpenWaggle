import { existsSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import NotFound from '../404.astro';

async function renderNotFound() {
  const container = await AstroContainer.create({ astroConfig: { site: 'https://openwaggle.ai' } });
  return container.renderToString(NotFound, { request: new Request('https://openwaggle.ai/docs/does-not-exist/') });
}

describe('not-found page', () => {
  // Cloudflare Pages answers unknown paths with the homepage and a 200 unless the build has a
  // top-level 404.html; Astro writes src/pages/404.astro to exactly that file.
  it('is the top-level 404 route Cloudflare Pages serves with a 404 status', () => {
    expect(existsSync(new URL('../404.astro', import.meta.url))).toBe(true);
  });

  it('says the page is missing and links back to the homepage and the docs', async () => {
    const html = await renderNotFound();
    expect(html).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/u);
    expect(html).toMatch(/<title>Page not found \| OpenWaggle<\/title>/u);
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>\s*Go to the homepage\s*<\/a>/u);
    expect(html).toMatch(/<a\b[^>]*href="\/docs\/getting-started\/first-run\/"[^>]*>\s*Read the docs\s*<\/a>/u);
    expect(html).not.toContain('Pair two agents in a Waggle');
  });

  it('keeps itself out of search results and claims no canonical URL', async () => {
    const html = await renderNotFound();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
  });
});
