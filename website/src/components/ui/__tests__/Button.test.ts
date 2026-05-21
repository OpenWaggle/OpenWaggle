import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Button from '../Button.astro';

describe('website Button', () => {
  it('renders internal links with the shared primary style', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Button, {
      props: { href: '/docs/getting-started/installation' },
      slots: { default: 'Install' },
    });

    expect(html).toContain('href="/docs/getting-started/installation"');
    expect(html).toContain('from-accent');
    expect(html).toContain('Install');
  });

  it('adds safe external-link attributes', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Button, {
      props: { href: 'https://github.com/OpenWaggle/OpenWaggle', variant: 'secondary' },
      slots: { default: 'GitHub' },
    });

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('border-border-light');
  });

  it('renders native buttons with type and icon sizing', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Button, {
      props: { size: 'icon', variant: 'ghost', type: 'submit', 'aria-label': 'Toggle menu' },
      slots: { default: 'Menu' },
    });

    expect(html).toContain('<button');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="Toggle menu"');
    expect(html).toContain('h-8 w-8');
  });
});
