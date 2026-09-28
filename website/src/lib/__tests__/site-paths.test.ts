import { describe, expect, it } from 'vitest';
import { docsPath, rehypeTrailingSlashLinks, withTrailingSlash } from '../site-paths';

describe('withTrailingSlash', () => {
  it.each([
    ['/docs/providers/overview', '/docs/providers/overview/'],
    ['/docs/configuration/mcp#configuration-files', '/docs/configuration/mcp/#configuration-files'],
    ['/docs/packages/pi-waggle/0.1', '/docs/packages/pi-waggle/0.1/'],
    ['/docs/x?tab=1#y', '/docs/x/?tab=1#y'],
    ['/', '/'],
    ['/docs/x/', '/docs/x/'],
    ['/screenshots/hive-sessions.png', '/screenshots/hive-sessions.png'],
    ['/sitemap-index.xml', '/sitemap-index.xml'],
    ['https://github.com/OpenWaggle/OpenWaggle', 'https://github.com/OpenWaggle/OpenWaggle'],
    ['//cdn.example.com/a', '//cdn.example.com/a'],
    ['#section', '#section'],
  ])('%s -> %s', (input, expected) => {
    expect(withTrailingSlash(input)).toBe(expected);
  });

  it('builds docs page URLs', () => {
    expect(docsPath('getting-started/first-run')).toBe('/docs/getting-started/first-run/');
  });
});

describe('rehypeTrailingSlashLinks', () => {
  it('rewrites nested internal links and leaves other elements alone', () => {
    const link = { type: 'element', tagName: 'a', properties: { href: '/docs/extending/plugins#review' }, children: [] };
    const image = { type: 'element', tagName: 'img', properties: { src: '/docs/not-a-link' }, children: [] };
    const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children: [link, image] }] };
    rehypeTrailingSlashLinks()(tree);
    expect(link.properties.href).toBe('/docs/extending/plugins/#review');
    expect(image.properties.src).toBe('/docs/not-a-link');
  });
});

describe('hard-coded internal links', () => {
  it('already use the trailing-slash URL in every component', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../../', import.meta.url).pathname;
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.astro') && !file.includes('__tests__'));
    const offenders = files.flatMap((file) =>
      [...readFileSync(join(root, file), 'utf8').matchAll(/href(?:=|: )["'](\/[^"'{}]*)["']/g)]
        .map(([, href = '']) => href)
        .filter((href) => withTrailingSlash(href) !== href)
        .map((href) => `${file}: ${href}`),
    );
    expect(offenders).toEqual([]);
  });
});
