import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { packageDocumentation } from '@/data/package-docs';
import PackageVersionSelect from '../PackageVersionSelect.astro';

describe('package documentation header', () => {
  it('renders accessible version and package-local navigation', async () => {
    const definition = packageDocumentation.find((entry) => entry.slug === 'extension-react');
    if (!definition) throw new Error('Missing extension-react documentation definition.');

    const container = await AstroContainer.create();
    const html = await container.renderToString(PackageVersionSelect, {
      props: { definition, page: 'components', version: '0.1' },
    });

    expect(html).toContain('Documentation version for @openwaggle/extension-react');
    expect(html).toContain('/docs/packages/extension-react/0.1/api-reference/');
    expect(html).toContain('/docs/packages/extension-react/0.1/components/');
    expect(html).toContain('aria-current="page"');
  });
});
