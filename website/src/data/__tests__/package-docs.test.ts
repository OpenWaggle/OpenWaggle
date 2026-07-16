import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  packageDocumentation,
  packageDocumentationPage,
  packageDocumentationPageRoute,
} from '../package-docs';

describe('package documentation routes', () => {
  it('keeps latest aliases on the current major.minor line', () => {
    expect(packageDocumentationPage('packages/extension-sdk')).toMatchObject({
      page: 'guide',
      version: '0.1',
    });
    expect(packageDocumentationPageRoute('extension-sdk', '0.1', 'api-reference')).toBe(
      '/docs/packages/extension-sdk/0.1/api-reference/',
    );
  });

  it('exposes the component catalogue only for the React package', () => {
    expect(packageDocumentationPage('packages/extension-react/0.1/components')).toMatchObject({
      page: 'components',
      version: '0.1',
    });
    expect(packageDocumentationPage('packages/extension-sdk/0.1/components')).toBeUndefined();
  });

  it('uses exact major.minor documentation versions for every package', () => {
    for (const definition of packageDocumentation) {
      expect(definition.currentVersion).toMatch(/^\d+\.\d+$/u);
      expect(definition.versions).toContain(definition.currentVersion);
    }
  });

  it('catalogues every Alert tone with a rendered example', async () => {
    const catalogue = await readFile(
      new URL('../../content/docs/packages/extension-react/0.1/components.md', import.meta.url),
      'utf8',
    );

    for (const tone of ['neutral', 'accent', 'success', 'warning', 'danger', 'info']) {
      expect(catalogue).toContain(
        `<div class="ow-extension-alert" data-ow-tone="${tone}"`,
      );
    }
  });
});
