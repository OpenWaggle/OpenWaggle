import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ARCHIVE_EXPANDED_LIMIT_BYTES } from '../syntax-resource-import-utils'
import { parseSyntaxThemeSource } from '../syntax-theme-import'

function theme(label: string, foreground: string) {
  return {
    name: label,
    type: 'dark',
    tokenColors: [{ scope: 'keyword', settings: { foreground } }],
  }
}

describe('VS Code theme include aggregate limits', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-theme-include-limit-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects a standalone include chain over the aggregate byte budget', async () => {
    const paddingLength = Math.floor(ARCHIVE_EXPANDED_LIMIT_BYTES / 3) + 1_024
    const basePath = path.join(temporaryRoot, 'large-base.json')
    const middlePath = path.join(temporaryRoot, 'large-middle.json')
    const childPath = path.join(temporaryRoot, 'large-child.json')
    await fs.writeFile(
      basePath,
      JSON.stringify({ ...theme('Large base', '#ff0000'), padding: 'x'.repeat(paddingLength) }),
    )
    await fs.writeFile(
      middlePath,
      JSON.stringify({
        ...theme('Large middle', '#00ff00'),
        include: './large-base.json',
        padding: 'x'.repeat(paddingLength),
      }),
    )
    await fs.writeFile(
      childPath,
      JSON.stringify({
        ...theme('Large child', '#0000ff'),
        include: './large-middle.json',
        padding: 'x'.repeat(paddingLength),
      }),
    )

    await expect(parseSyntaxThemeSource(childPath, 'user')).rejects.toThrow(
      'include chain exceeds the aggregate byte limit',
    )
  })

  it('rejects an include symlink that resolves outside the theme directory', async () => {
    const themeDirectory = path.join(temporaryRoot, 'theme-package')
    const outsidePath = path.join(temporaryRoot, 'outside.json')
    await fs.mkdir(themeDirectory)
    await fs.writeFile(outsidePath, JSON.stringify(theme('Outside', '#ff0000')))
    await fs.symlink(outsidePath, path.join(themeDirectory, 'linked-base.json'))
    const childPath = path.join(themeDirectory, 'child.json')
    await fs.writeFile(
      childPath,
      JSON.stringify({ ...theme('Child', '#00ff00'), include: './linked-base.json' }),
    )

    await expect(parseSyntaxThemeSource(childPath, 'project')).rejects.toThrow(
      'outside its package',
    )
  })

  it('rejects an unpacked include chain over the aggregate complexity budget', async () => {
    const themesDirectory = path.join(temporaryRoot, 'themes')
    await fs.mkdir(themesDirectory)
    await fs.writeFile(
      path.join(temporaryRoot, 'package.json'),
      JSON.stringify({
        publisher: 'acme',
        name: 'complex-includes',
        contributes: {
          themes: [{ label: 'Complex includes', path: './themes/child.json' }],
        },
      }),
    )
    const padding = Array.from({ length: 40_000 }, (_, index) => index)
    await fs.writeFile(
      path.join(themesDirectory, 'base.json'),
      JSON.stringify({ ...theme('Base', '#ff0000'), padding }),
    )
    await fs.writeFile(
      path.join(themesDirectory, 'middle.json'),
      JSON.stringify({ ...theme('Middle', '#00ff00'), include: './base.json', padding }),
    )
    await fs.writeFile(
      path.join(themesDirectory, 'child.json'),
      JSON.stringify({ ...theme('Child', '#0000ff'), include: './middle.json', padding }),
    )

    await expect(parseSyntaxThemeSource(temporaryRoot, 'user')).rejects.toThrow(
      'include chain exceeds the aggregate complexity limit',
    )
  })
})
