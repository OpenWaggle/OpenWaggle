import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Hero from '../Hero.astro';

describe('landing hero', () => {
  it('shows the logo mark and the existing wordmark asset', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero);
    expect(html).toContain('src="/logo-mark.svg"');
    expect(html).toMatch(/src="\/logo-wordmark.svg" alt="OpenWaggle"/);
  });

  it('sends the download button to the installation guide instead of leaving the site', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero);
    const download = html.match(/<a\b[^>]*>\s*Download OpenWaggle\s*<\/a>/)?.[0];
    expect(download).toContain('href="/docs/getting-started/installation/"');
    expect(download).not.toContain('target="_blank"');
    expect(html).not.toContain('github.com/OpenWaggle/OpenWaggle/releases');
  });

  it('labels the background motion control without a visible caption', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero);
    expect(html).toMatch(/id="honeycomb-motion"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/id="honeycomb-motion"[^>]*aria-label="Pause background animation"/);
    expect(html).not.toContain('Inside OpenWaggle');
  });
});
