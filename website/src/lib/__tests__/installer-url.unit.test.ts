import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INSTALL_COMMAND,
  INSTALL_SCRIPT_URL,
  RAW_INSTALL_SCRIPT_URL,
  substituteInstallPlaceholders,
} from '../install-command'
import { docsPageFiles } from './docs-page-files'

const SHORTCUT_PATH = new URL(INSTALL_SCRIPT_URL).pathname
const SHORTCUT_PATHS = [SHORTCUT_PATH, `${SHORTCUT_PATH}/`, `${SHORTCUT_PATH}.sh`]

function redirectRules() {
  return readFileSync(new URL('../../../public/_redirects', import.meta.url), 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/u))
}

function read(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

describe('the openwaggle.ai/install shortcut', () => {
  // `curl -fsSL https://openwaggle.ai/install | bash` must reach the script, never a page.
  it('redirects /install, /install/ and /install.sh to the raw installer on main', () => {
    expect(redirectRules().filter(([source]) => source?.startsWith(SHORTCUT_PATH))).toEqual(
      SHORTCUT_PATHS.map((source) => [source, RAW_INSTALL_SCRIPT_URL, '302']),
    )
  })

  // They cannot read install-command.ts, so they must not drift from it.
  it('is the command README.md and scripts/install.sh document', () => {
    expect(read('../../../../README.md')).toContain(`\n${INSTALL_COMMAND}\n`)
    const script = read('../../../../scripts/install.sh')
    expect(script).toContain(`\n# Usage: ${INSTALL_COMMAND}\n`)
    expect(script).toContain(`\n# ${RAW_INSTALL_SCRIPT_URL}\n`)
  })

  it('is written only through the placeholders on docs pages', () => {
    for (const page of docsPageFiles()) {
      expect(page.text, page.path).not.toContain(INSTALL_SCRIPT_URL)
      expect(page.text, page.path).not.toContain(RAW_INSTALL_SCRIPT_URL)
    }
  })

  it('starts every install command in the installation guide', () => {
    const guide = substituteInstallPlaceholders(
      read('../../content/docs/getting-started/installation.md'),
    )
    const commands = guide.match(/^curl .*$/gmu) ?? []
    expect(commands[0]).toBe(INSTALL_COMMAND)
    expect(commands.length).toBeGreaterThan(1)
    expect(
      commands.filter((command) => !command.startsWith(`curl -fsSL ${INSTALL_SCRIPT_URL} |`)),
    ).toEqual([])
    // The raw address appears once, as the link for reading the script first.
    expect(guide.split(`[${RAW_INSTALL_SCRIPT_URL}](${RAW_INSTALL_SCRIPT_URL})`)).toHaveLength(2)
  })

  it('has no page, asset, function or Astro redirect that would answer with HTML first', () => {
    for (const asset of ['install', 'install.sh', 'install.html']) {
      expect(existsSync(new URL(`../../../public/${asset}`, import.meta.url))).toBe(false)
    }
    const pages = readdirSync(new URL('../../pages/', import.meta.url), {
      recursive: true,
      encoding: 'utf8',
    })
    expect(pages.filter((page) => page.startsWith('install'))).toEqual([])
    // Pages Functions run before _redirects; only the API has any.
    const functions = readdirSync(new URL('../../../../functions/', import.meta.url), {
      encoding: 'utf8',
    })
    expect(functions.filter((entry) => !entry.startsWith('_'))).toEqual(['api'])
    expect(read('../../../astro.config.ts')).not.toMatch(/['"]\/install(?:\.sh)?\/?['"]/u)
  })
})
