import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL_INSTALLER_URL = 'https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh';

function redirectRules() {
  return readFileSync(new URL('../../../public/_redirects', import.meta.url), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/u));
}

describe('the openwaggle.ai/install.sh shortcut', () => {
  // `curl -fsSL https://openwaggle.ai/install.sh | bash` must reach the script, never a page.
  it('redirects to the raw installer the installation guide uses', () => {
    expect(redirectRules().filter(([source]) => source?.startsWith('/install.sh'))).toEqual([
      ['/install.sh', CANONICAL_INSTALLER_URL, '302'],
    ]);
    const guide = readFileSync(new URL('../../content/docs/getting-started/installation.md', import.meta.url), 'utf8');
    expect(guide).toContain(`curl -fsSL ${CANONICAL_INSTALLER_URL} | bash`);
  });

  it('has no page, asset, or Astro redirect that would answer with HTML first', () => {
    expect(existsSync(new URL('../../../public/install.sh', import.meta.url))).toBe(false);
    const pages = readdirSync(new URL('../../pages/', import.meta.url), { recursive: true, encoding: 'utf8' });
    expect(pages.filter((page) => page.startsWith('install'))).toEqual([]);
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8');
    expect(config).not.toContain('install.sh');
  });
});
