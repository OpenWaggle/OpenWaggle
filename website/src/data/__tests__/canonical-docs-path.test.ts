import { describe, expect, it } from 'vitest';
import { canonicalDocsPath, packageDocumentation, packageDocumentationRoute } from '../package-docs';

describe('canonicalDocsPath', () => {
  it('links regular docs pages at their trailing-slash URL', () => {
    expect(canonicalDocsPath('getting-started/installation')).toBe('/docs/getting-started/installation/');
    expect(canonicalDocsPath('packages/overview')).toBe('/docs/packages/overview/');
  });

  it('resolves every package alias to its current versioned page', () => {
    expect(packageDocumentation.length).toBeGreaterThan(0);
    for (const definition of packageDocumentation) {
      expect(canonicalDocsPath(`packages/${definition.slug}`)).toBe(
        packageDocumentationRoute(definition.slug, definition.currentVersion),
      );
    }
  });
});
