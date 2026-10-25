import { existsSync, readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import NotFound from '../404.astro';

async function renderNotFound() {
  const container = await AstroContainer.create({ astroConfig: { site: 'https://openwaggle.ai' } });
  return container.renderToString(NotFound, { request: new Request('https://openwaggle.ai/docs/does-not-exist/') });
}

const DIST = new URL('../../../dist/', import.meta.url);

describe('not-found page', () => {
  // Cloudflare Pages answers unknown paths with the homepage and a 200 unless the build has a
  // top-level 404.html. The release rehearsal runs `website:build` before `website:test`, so this
  // checks the artifact the host serves; without a build there is nothing to check.
  it.skipIf(!existsSync(DIST))('is built to the top-level 404.html Cloudflare Pages serves with a 404 status', () => {
    const page = readFileSync(new URL('404.html', DIST), 'utf8');
    expect(page).toContain('<title>Page not found | OpenWaggle</title>');
    expect(readFileSync(new URL('sitemap-0.xml', DIST), 'utf8')).not.toMatch(/<loc>[^<]*\/404\/?<\/loc>/u);
    expect(existsSync(new URL('install.sh', DIST))).toBe(false);
    expect(readFileSync(new URL('_redirects', DIST), 'utf8')).toMatch(/^\/install\.sh\s+https:\/\/raw\.githubusercontent\.com\/\S+\s+302$/mu);
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
