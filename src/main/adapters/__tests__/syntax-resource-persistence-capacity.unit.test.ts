import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INSTALLED_RESOURCE_CATALOG_MAX_BYTES } from '../syntax-resource-persistence-read'
import {
  applySyntaxThemePreview,
  listInstalledSyntaxThemes,
  parseSyntaxThemeSource,
} from '../syntax-theme-import'

function theme(label: string, foreground: string) {
  return {
    name: label,
    type: 'dark',
    colors: { 'editor.background': '#101010' },
    tokenColors: [{ scope: 'keyword', settings: { foreground } }],
  }
}

describe('syntax resource persistence capacity', () => {
  let temporaryRoot = ''
  let resourcesDirectory = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-syntax-capacity-'))
    resourcesDirectory = path.join(temporaryRoot, 'installed')
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects an over-budget staged library without replacing the installed library', async () => {
    const firstPath = path.join(temporaryRoot, 'first-large.json')
    const secondPath = path.join(temporaryRoot, 'second-large.json')
    await Promise.all([
      fs.writeFile(firstPath, JSON.stringify(theme('First Large', '#abcdef'))),
      fs.writeFile(secondPath, JSON.stringify(theme('Second Large', '#fedcba'))),
    ])
    const [firstCatalog, secondCatalog] = await Promise.all([
      parseSyntaxThemeSource(firstPath, 'user'),
      parseSyntaxThemeSource(secondPath, 'user'),
    ])
    const firstTheme = firstCatalog.themes[0]
    const secondTheme = secondCatalog.themes[0]
    if (!firstTheme || !secondTheme) throw new Error('Expected two parsed themes.')
    const padding = 'x'.repeat(Math.floor(INSTALLED_RESOURCE_CATALOG_MAX_BYTES / 2))

    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'first-large',
      sourcePath: firstPath,
      themes: [{ ...firstTheme, original: { ...firstTheme.original, padding } }],
      languages: [],
      appearances: [],
      replacements: [],
      warnings: [],
    })

    await expect(
      applySyntaxThemePreview(resourcesDirectory, {
        token: 'second-large',
        sourcePath: secondPath,
        themes: [{ ...secondTheme, original: { ...secondTheme.original, padding } }],
        languages: [],
        appearances: [],
        replacements: [],
        warnings: [],
      }),
    ).rejects.toThrow('aggregate byte limit')

    const installed = await listInstalledSyntaxThemes(resourcesDirectory)
    expect(installed.themes).toHaveLength(1)
    expect(installed.themes[0]).toMatchObject({ id: firstTheme.id, label: 'First Large' })
  })
})
