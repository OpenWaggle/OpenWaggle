import { readFileSync } from 'node:fs'
import { unified } from '@astrojs/markdown-remark'
import { describe, expect, it } from 'vitest'
import {
  INSTALL_COMMAND,
  RAW_INSTALL_SCRIPT_URL,
  substituteInstallPlaceholders,
} from '../install-command'
import { remarkInstallCommand } from '../markdown-install-command'

async function render(markdown: string) {
  // Shiki is Astro's default highlighter; the placeholders must be filled in before it runs.
  const processor = await unified({ remarkPlugins: [remarkInstallCommand] }).createRenderer({
    syntaxHighlight: 'shiki',
  })
  return (await processor.render(markdown, { fileURL: new URL('file:///docs/installation.md') }))
    .code
}

/** The text a reader sees, without Shiki's markup. */
function visibleText(html: string) {
  return html
    .replace(/<[^>]+>/gu, '')
    .replaceAll('&#x26;', '&')
    .replaceAll('&amp;', '&')
}

describe('install command placeholders', () => {
  it('fills in code blocks, inline code and link targets', async () => {
    const html = await render(
      [
        'Read [the script]({{install-script-raw-url}}) behind `{{install-url}}`.',
        '',
        '```bash',
        '{{install-command}}',
        '```',
        '',
        '```bash',
        'curl -fsSL {{install-url}} | bash -s -- --no-launch',
        '```',
      ].join('\n'),
    )

    expect(html).toContain(`href="${RAW_INSTALL_SCRIPT_URL}"`)
    expect(html).not.toContain('{{')
    const text = visibleText(html)
    expect(text).toContain(INSTALL_COMMAND)
    expect(text).toContain('curl -fsSL https://openwaggle.ai/install | bash -s -- --no-launch')
    expect(text).toContain('behind https://openwaggle.ai/install.')
  })

  it('fails the build on an unknown placeholder, naming the page', async () => {
    await expect(render('```bash\n{{install-commmand}}\n```')).rejects.toThrow(
      '/docs/installation.md: Unknown install placeholder {{install-commmand}}.',
    )
    expect(() => substituteInstallPlaceholders('{{install-}}')).toThrow(
      'Unknown install placeholder',
    )
  })

  it('runs for every docs page the site builds', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8')
    expect(config).toMatch(/remarkPlugins: \[[^\]]*\bremarkInstallCommand\b[^\]]*\]/u)
  })
})
