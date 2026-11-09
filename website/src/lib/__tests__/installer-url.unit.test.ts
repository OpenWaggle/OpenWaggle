import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RAW_INSTALLER_URL = 'https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh';
const SHORT_INSTALL_COMMAND = 'curl -fsSL https://openwaggle.ai/install | bash';
const SHORTCUT_PATHS = ['/install', '/install/', '/install.sh'];

function redirectRules() {
  return readFileSync(new URL('../../../public/_redirects', import.meta.url), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/u));
}

function read(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('the openwaggle.ai/install shortcut', () => {
  // `curl -fsSL https://openwaggle.ai/install | bash` must reach the script, never a page.
  it('redirects /install, /install/ and /install.sh to the raw installer on main', () => {
    expect(redirectRules().filter(([source]) => source?.startsWith('/install'))).toEqual(
      SHORTCUT_PATHS.map((source) => [source, RAW_INSTALLER_URL, '302']),
    );
  });

  it('is the command the README, the installation guide and the script itself document', () => {
    const guide = read('../../content/docs/getting-started/installation.md');
    expect(guide).toContain(SHORT_INSTALL_COMMAND);
    expect(read('../../../../README.md')).toContain(SHORT_INSTALL_COMMAND);
    expect(read('../../../../scripts/install.sh')).toContain(`# Usage: ${SHORT_INSTALL_COMMAND}`);
    // Every command uses the shortcut; the raw URL stays only as the read-it-first fallback.
    const commands = guide.match(/^curl .*$/gmu) ?? [];
    expect(commands.length).toBeGreaterThan(1);
    expect(commands.filter((command) => !command.startsWith('curl -fsSL https://openwaggle.ai/install |'))).toEqual([]);
    expect(guide.split(RAW_INSTALLER_URL)).toHaveLength(2);
  });

  it('has no page, asset, function or Astro redirect that would answer with HTML first', () => {
    for (const asset of ['install', 'install.sh', 'install.html']) {
      expect(existsSync(new URL(`../../../public/${asset}`, import.meta.url))).toBe(false);
    }
    const pages = readdirSync(new URL('../../pages/', import.meta.url), { recursive: true, encoding: 'utf8' });
    expect(pages.filter((page) => page.startsWith('install'))).toEqual([]);
    // Pages Functions run before _redirects; only the API has any.
    const functions = readdirSync(new URL('../../../../functions/', import.meta.url), { encoding: 'utf8' });
    expect(functions.filter((entry) => !entry.startsWith('_'))).toEqual(['api']);
    const config = read('../../../astro.config.ts');
    expect(config).not.toMatch(/['"]\/install(?:\.sh)?\/?['"]/u);
  });
});
