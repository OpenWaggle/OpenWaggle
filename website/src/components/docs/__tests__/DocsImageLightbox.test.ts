import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import DocsImageLightbox from '../DocsImageLightbox.astro';

describe('docs image lightbox', () => {
  it('opens linked images in a keyboard-reachable modal dialog', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(DocsImageLightbox);
    expect(html).toMatch(/<dialog id="docs-image-lightbox"[^>]*aria-label="Full-size image"/u);
    // The native dialog closes on Escape; the script moves focus to Close when it opens.
    expect(html).toMatch(/<form method="dialog">\s*<button type="submit"[^>]*id="docs-image-lightbox-close"[^>]*>\s*Close\s*<\/button>/u);
    expect(html).toContain('Open image file');
  });

  it('moves focus into the dialog when it opens', () => {
    const source = readFileSync(new URL('../DocsImageLightbox.astro', import.meta.url), 'utf8');
    expect(source).toMatch(/dialog\.showModal\(\);\s*close\.focus\(\);/u);
  });

  it('is on every docs page', () => {
    const layout = readFileSync(new URL('../../../layouts/DocsLayout.astro', import.meta.url), 'utf8');
    expect(layout).toContain('<DocsImageLightbox />');
  });
});
