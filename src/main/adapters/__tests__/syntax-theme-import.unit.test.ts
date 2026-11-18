import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applySyntaxThemePreview,
  listInstalledSyntaxThemes,
  parseSyntaxThemeSource,
  removeInstalledSyntaxTheme,
} from '../syntax-theme-import'

function theme(label: string, foreground: string) {
  return {
    name: label,
    type: 'dark',
    colors: { 'editor.background': '#101010' },
    tokenColors: [{ scope: 'keyword', settings: { foreground } }],
  }
}

describe('syntax resource imports', () => {
  let temporaryRoot = ''
  let resourcesDirectory = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-syntax-import-'))
    resourcesDirectory = path.join(temporaryRoot, 'installed')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('resolves a root-confined VS Code include while retaining the child source', async () => {
    const basePath = path.join(temporaryRoot, 'base.json')
    const childPath = path.join(temporaryRoot, 'child.jsonc')
    await fs.writeFile(basePath, JSON.stringify(theme('Base', '#ff0000')))
    await fs.writeFile(
      childPath,
      `{
        // VS Code JSONC is accepted.
        "name": "Child",
        "include": "./base.json",
        "tokenColors": [{ "scope": "string", "settings": { "foreground": "#00ff00" } }]
      }`,
    )

    const catalog = await parseSyntaxThemeSource(childPath, 'user')

    expect(catalog.themes).toHaveLength(1)
    expect(catalog.themes[0]?.theme.settings).toHaveLength(2)
    expect(catalog.themes[0]?.original).toMatchObject({ include: './base.json' })
    expect(catalog.themes[0]?.original).not.toHaveProperty('colors')
  })

  it('keeps the selection id stable while changing the renderer identity on replacement', async () => {
    const themePath = path.join(temporaryRoot, 'replaceable.json')
    await fs.writeFile(themePath, JSON.stringify(theme('Replaceable', '#ff0000')))
    const first = await parseSyntaxThemeSource(themePath, 'user')
    await fs.writeFile(themePath, JSON.stringify(theme('Replaceable', '#00ff00')))
    const second = await parseSyntaxThemeSource(themePath, 'user')

    expect(second.themes[0]?.id).toBe(first.themes[0]?.id)
    expect(second.themes[0]?.revision).not.toBe(first.themes[0]?.revision)
    expect(second.themes[0]?.theme.name).not.toBe(first.themes[0]?.theme.name)
    expect(second.themes[0]?.theme.name).toMatch(/^theme:replaceable:dark:[0-9a-f]{16}$/u)
  })

  it('rejects cyclic and escaping theme includes', async () => {
    const firstPath = path.join(temporaryRoot, 'first.json')
    const secondPath = path.join(temporaryRoot, 'second.json')
    await fs.writeFile(
      firstPath,
      JSON.stringify({ ...theme('First', '#fff'), include: './second.json' }),
    )
    await fs.writeFile(
      secondPath,
      JSON.stringify({ ...theme('Second', '#fff'), include: './first.json' }),
    )

    await expect(parseSyntaxThemeSource(firstPath, 'user')).rejects.toThrow('cycle')

    const packageDirectory = path.join(temporaryRoot, 'extension')
    await fs.mkdir(packageDirectory)
    await fs.writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: 'unsafe',
        contributes: { themes: [{ label: 'Unsafe', path: '../first.json' }] },
      }),
    )
    await expect(parseSyntaxThemeSource(packageDirectory, 'user')).rejects.toThrow(
      'outside its package',
    )
  })

  it('imports native app-appearance groundwork and an isolated grammar together', async () => {
    const packagePath = path.join(temporaryRoot, 'native.openwaggle.json')
    await fs.writeFile(
      packagePath,
      JSON.stringify({
        schemaVersion: 1,
        publisher: 'acme',
        name: 'complete-theme',
        themes: [{ label: 'Acme Dark', variant: 'dark', theme: theme('Acme Dark', '#aabbcc') }],
        languages: [
          {
            language: { id: 'acme', aliases: ['Acme'], extensions: ['.acme'] },
            scopeName: 'source.acme',
            grammar: {
              name: 'acme',
              scopeName: 'source.acme',
              patterns: [{ match: '(?<=a)b', name: 'keyword.acme' }],
              repository: {},
            },
          },
        ],
        appearances: [
          {
            label: 'Acme App Dark',
            variant: 'dark',
            tokens: {
              color: {},
              typography: {},
              spacing: {},
              radius: {},
              shadow: {},
              focus: {},
            },
          },
        ],
      }),
    )

    const catalog = await parseSyntaxThemeSource(packagePath, 'user')

    expect(catalog.themes[0]?.id).toBe('theme:acme.complete-theme:dark')
    expect(catalog.languages[0]).toMatchObject({ languageId: 'acme', engine: 'oniguruma' })
    expect(catalog.appearances[0]).toMatchObject({
      id: 'appearance:acme.complete-theme:dark',
      variant: 'dark',
    })
  })

  it('imports a VSIX theme and language contribution within expansion bounds', async () => {
    const archive = new JSZip()
    archive.file(
      'extension/package.json',
      JSON.stringify({
        publisher: 'acme',
        name: 'vsix-pack',
        contributes: {
          themes: [{ label: 'VSIX Dark', uiTheme: 'vs-dark', path: './themes/dark.json' }],
          languages: [
            {
              id: 'acme',
              aliases: ['Acme'],
              extensions: ['.acme'],
              configuration: './language-configuration.json',
            },
          ],
          grammars: [
            { language: 'acme', scopeName: 'source.acme', path: './syntaxes/acme.tmLanguage.json' },
          ],
        },
      }),
    )
    archive.file('extension/themes/dark.json', JSON.stringify(theme('VSIX Dark', '#abcdef')))
    archive.file(
      'extension/syntaxes/acme.tmLanguage.json',
      JSON.stringify({ name: 'acme', scopeName: 'source.acme', patterns: [], repository: {} }),
    )
    archive.file(
      'extension/language-configuration.json',
      JSON.stringify({
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [
          ['{', '}'],
          ['[', ']'],
        ],
        autoClosingPairs: [{ open: '"', close: '"', notIn: ['string', 'comment'] }],
        surroundingPairs: [['(', ')']],
        autoCloseBefore: ';:.,=}])>\n\t ',
        wordPattern: '(a+)+$',
        indentationRules: { increaseIndentPattern: '(a+)+$' },
      }),
    )
    const archivePath = path.join(temporaryRoot, 'pack.vsix')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer' }))

    const catalog = await parseSyntaxThemeSource(archivePath, 'user')

    expect(catalog.themes[0]).toMatchObject({ format: 'vscode-vsix', variant: 'dark' })
    expect(catalog.languages[0]).toMatchObject({
      format: 'vscode-vsix',
      languageId: 'acme',
      registration: {
        configuration: {
          comments: { lineComment: '//', blockComment: ['/*', '*/'] },
          brackets: [
            ['{', '}'],
            ['[', ']'],
          ],
          autoClosingPairs: [{ open: '"', close: '"', notIn: ['string', 'comment'] }],
          surroundingPairs: [{ open: '(', close: ')' }],
          autoCloseBefore: ';:.,=}])>\n\t ',
        },
      },
    })
    expect(catalog.languages[0]?.registration.configuration).not.toHaveProperty('wordPattern')
    expect(catalog.languages[0]?.registration.configuration).not.toHaveProperty('indentationRules')
  })

  it('keeps multiple dark themes from one extension under distinct stable identities', async () => {
    const archive = new JSZip()
    archive.file(
      'extension/package.json',
      JSON.stringify({
        publisher: 'acme',
        name: 'theme-family',
        contributes: {
          themes: [
            { label: 'Acme Dark', uiTheme: 'vs-dark', path: './themes/dark.json' },
            { label: 'Acme Dark', uiTheme: 'vs-dark', path: './themes/dimmed.json' },
          ],
        },
      }),
    )
    archive.file('extension/themes/dark.json', JSON.stringify(theme('Acme Dark', '#abcdef')))
    archive.file('extension/themes/dimmed.json', JSON.stringify(theme('Acme Dark', '#fedcba')))
    const archivePath = path.join(temporaryRoot, 'family.vsix')
    await fs.writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer' }))

    const catalog = await parseSyntaxThemeSource(archivePath, 'user')

    expect(catalog.themes).toHaveLength(2)
    expect(new Set(catalog.themes.map((resource) => resource.id)).size).toBe(2)
    await expect(
      applySyntaxThemePreview(resourcesDirectory, {
        token: 'family',
        sourcePath: archivePath,
        ...catalog,
        replacements: [],
        warnings: [],
      }),
    ).resolves.toBeUndefined()
    await expect(listInstalledSyntaxThemes(resourcesDirectory)).resolves.toMatchObject({
      themes: [{ label: 'Acme Dark' }, { label: 'Acme Dark' }],
    })
  })

  it('enforces the installed-library cap across separate imports without hiding resources', async () => {
    const themePath = path.join(temporaryRoot, 'bounded.json')
    await fs.writeFile(themePath, JSON.stringify(theme('Bounded', '#abcdef')))
    const catalog = await parseSyntaxThemeSource(themePath, 'user')
    const baseTheme = catalog.themes[0]
    if (!baseTheme) throw new Error('Expected a parsed theme.')
    const installedThemes = Array.from({ length: 20 }, (_, index) => ({
      ...baseTheme,
      id: `${baseTheme.id}:${String(index)}`,
      label: `Bounded ${String(index)}`,
    }))
    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'bounded',
      sourcePath: themePath,
      themes: installedThemes,
      languages: [],
      appearances: [],
      replacements: [],
      warnings: [],
    })

    await expect(
      applySyntaxThemePreview(resourcesDirectory, {
        token: 'overflow',
        sourcePath: themePath,
        themes: [{ ...baseTheme, id: `${baseTheme.id}:overflow` }],
        languages: [],
        appearances: [],
        replacements: [],
        warnings: [],
      }),
    ).rejects.toThrow('library limit')

    const installed = await listInstalledSyntaxThemes(resourcesDirectory)
    expect(installed.themes).toHaveLength(20)
  })

  it('persists atomically, lets project resources override identities, and removes user resources', async () => {
    const userPath = path.join(temporaryRoot, 'user.json')
    await fs.writeFile(userPath, JSON.stringify(theme('Shared', '#111111')))
    const userCatalog = await parseSyntaxThemeSource(userPath, 'user')
    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'preview',
      sourcePath: userPath,
      ...userCatalog,
      replacements: [],
      warnings: [],
    })
    const projectPath = path.join(temporaryRoot, 'project')
    const projectThemeDirectory = path.join(projectPath, '.openwaggle', 'themes')
    await fs.mkdir(projectThemeDirectory, { recursive: true })
    await fs.writeFile(
      path.join(projectThemeDirectory, 'shared.json'),
      JSON.stringify(theme('Shared', '#eeeeee')),
    )

    const merged = await listInstalledSyntaxThemes(resourcesDirectory, projectPath)
    expect(merged.themes).toHaveLength(1)
    expect(merged.themes[0]).toMatchObject({ scope: 'project' })
    expect(merged.themes[0]?.theme.settings[0]?.settings.foreground).toBe('#eeeeee')

    const userId = userCatalog.themes[0]?.id
    if (!userId) throw new Error('Expected a user theme identity.')
    await removeInstalledSyntaxTheme(resourcesDirectory, userId)
    await expect(listInstalledSyntaxThemes(resourcesDirectory)).resolves.toMatchObject({
      themes: [],
    })
  })
})
