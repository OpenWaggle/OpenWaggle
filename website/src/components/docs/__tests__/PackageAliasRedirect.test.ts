import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import PackageAliasRedirect from '../PackageAliasRedirect.astro';

describe('package alias redirect', () => {
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
