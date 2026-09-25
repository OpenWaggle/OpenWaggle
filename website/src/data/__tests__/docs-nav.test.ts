import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { developerDocsNav, docsNav, flatNavItems, getPrevNext, isDeveloperDoc } from '../docs-nav';
import { packageDocumentation } from '../package-docs';

const userItems = docsNav.flatMap((section) => section.items);
const developerItems = developerDocsNav.flatMap((section) => section.items);

describe('documentation navigation', () => {
  it('links only to existing pages or current package aliases', () => {
    for (const item of flatNavItems()) {
      const definition = packageDocumentation.find((entry) => item.slug === `packages/${entry.slug}`);
      const slug = definition ? `${item.slug}/${definition.currentVersion}/index` : item.slug;
      const exists = ['md', 'mdx'].some((extension) =>
        existsSync(new URL(`../../content/docs/${slug}.${extension}`, import.meta.url)),
      );
      expect(exists, `Missing navigation destination: ${item.slug}`).toBe(true);
    }
  });

  it('starts with the walkthrough and exposes the core app workflows', () => {
    expect(userItems[0]).toEqual({ title: 'Get started', slug: 'getting-started/first-run' });
    expect(userItems.map((item) => item.slug)).toEqual(expect.arrayContaining([
      'developer-workflow/browser-preview',
      'using-openwaggle/session-tree',
      'using-openwaggle/session-summary',
      'configuration/mcp',
    ]));
    expect(docsNav.map((section) => section.title)).toEqual([
      'Getting started', 'Using OpenWaggle', 'Customize', 'Multiple agents', 'Help',
    ]);
  });

  it('keeps technical references separate without duplicate destinations', () => {
    const slugs = flatNavItems().map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(isDeveloperDoc('packages/extension-sdk/0.1/api-reference')).toBe(true);
    expect(isDeveloperDoc('developer-guide/architecture')).toBe(true);
    expect(isDeveloperDoc('developer-workflow/browser-preview')).toBe(false);
    expect(isDeveloperDoc('extending/plugins')).toBe(false);
    expect(isDeveloperDoc('extending/pi-extensions')).toBe(true);
  });

  it('keeps previous/next links within their documentation area', () => {
    const lastUser = userItems.at(-1);
    const firstDeveloper = developerItems[0];
    expect(lastUser).toBeDefined();
    expect(firstDeveloper).toBeDefined();
    if (!lastUser || !firstDeveloper) throw new Error('Missing documentation area');
    expect(getPrevNext(lastUser.slug).next).toBeNull();
    expect(getPrevNext(firstDeveloper.slug).prev).toBeNull();
    expect(getPrevNext('getting-started/first-run')).toEqual({ prev: null, next: userItems[1] });
    expect(getPrevNext('providers/api-key-auth')).toEqual({ prev: null, next: null });
  });
});
