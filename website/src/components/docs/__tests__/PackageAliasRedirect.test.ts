import { runInNewContext } from 'node:vm';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi } from 'vitest';
import PackageAliasRedirect from '../PackageAliasRedirect.astro';

describe('package alias redirect', () => {
  it.each([
    { search: '', hash: '' },
    { search: '', hash: '#installation' },
    { search: '?from=guide', hash: '' },
    { search: '?from=guide', hash: '#api%20reference' },
  ])('preserves query and fragment $search$hash on the current host', async ({ search, hash }) => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(PackageAliasRedirect, {
      props: {
        destination: new URL('https://openwaggle.ai/docs/packages/extension-react/0.1/'),
        title: 'Extension React',
      },
    });
    const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    if (script === undefined) throw new Error('Missing immediate alias redirect script');
    const replace = vi.fn();
    runInNewContext(script, { window: { location: { search, hash, replace } } });
    expect(replace).toHaveBeenCalledExactlyOnceWith(`/docs/packages/extension-react/0.1/${search}${hash}`);
    expect(html).toMatch(/<noscript>\s*<meta http-equiv="refresh" content="0;url=\/docs\/packages\/extension-react\/0\.1\/"\s*\/?>\s*<\/noscript>/);
  });

  it('redirects immediately on the current host with a canonical URL and fallback link', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(PackageAliasRedirect, {
      props: {
        destination: new URL('https://openwaggle.ai/docs/packages/extension-sdk/0.1/'),
        title: 'Extension SDK',
      },
    });

    expect(html).toContain('http-equiv="refresh" content="0;url=/docs/packages/extension-sdk/0.1/"');
    expect(html).toContain('rel="canonical" href="https://openwaggle.ai/docs/packages/extension-sdk/0.1/"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('<a href="/docs/packages/extension-sdk/0.1/">Continue to Extension SDK</a>');
  });
});
