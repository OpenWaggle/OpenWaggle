import type { SyntaxLanguageResource, SyntaxThemeResource } from '@shared/types/syntax-resources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pierreMocks = vi.hoisted(() => ({
  registerCustomLanguage: vi.fn(),
  registerCustomTheme: vi.fn(),
}))

vi.mock('@pierre/diffs', () => ({
  registerCustomLanguage: pierreMocks.registerCustomLanguage,
  registerCustomTheme: pierreMocks.registerCustomTheme,
}))

import { setImportedPierreSyntaxResources } from '../pierre-syntax'
import { pierreLanguageId, registerPendingPierreSyntaxResources } from '../pierre-syntax-runtime'

function theme(name: string): SyntaxThemeResource {
  return {
    id: 'theme:acme:dark',
    packageId: 'acme',
    revision: name,
    label: 'Acme',
    variant: 'dark',
    scope: 'user',
    format: 'openwaggle',
    sourcePath: '/tmp/acme.json',
    theme: {
      name,
      displayName: 'Acme',
      type: 'dark',
      colors: { 'editor.background': 'var(--color-bg)' },
      settings: [{ scope: ['keyword'], settings: { foreground: 'var(--color-accent)' } }],
    },
    original: {},
  }
}

function language(revision: string): SyntaxLanguageResource {
  return {
    id: `language:acme:test:${revision}`,
    packageId: 'acme',
    revision,
    label: 'Acme Test',
    languageId: 'acme-test',
    scope: 'user',
    format: 'openwaggle',
    sourcePath: '/tmp/acme-language.json',
    engine: 'javascript',
    registration: {
      name: 'acme-test',
      displayName: 'Acme Test',
      scopeName: 'source.acme-test',
      aliases: ['acmetest'],
      fileExtensions: ['.acme'],
      fileNames: [],
      embeddedLanguages: {},
      injectTo: [],
      grammar: {
        name: 'acme-test',
        scopeName: 'source.acme-test',
        patterns: [],
        repository: {},
      },
    },
    original: {},
  }
}

describe('Pierre syntax theme registration', () => {
  beforeEach(() => pierreMocks.registerCustomTheme.mockClear())

  it('registers each immutable runtime revision once', async () => {
    setImportedPierreSyntaxResources([theme('theme:acme:dark:revision-1')], [])
    registerPendingPierreSyntaxResources()
    registerPendingPierreSyntaxResources()
    setImportedPierreSyntaxResources([theme('theme:acme:dark:revision-2')], [])
    registerPendingPierreSyntaxResources()

    expect(pierreMocks.registerCustomTheme).toHaveBeenCalledTimes(2)
    const firstLoader = pierreMocks.registerCustomTheme.mock.calls[0]?.[1]
    if (typeof firstLoader !== 'function') throw new Error('Expected a Pierre theme loader.')
    await expect(firstLoader()).resolves.toMatchObject({
      name: 'theme:acme:dark:revision-1',
      settings: [{ scope: ['keyword'], settings: { foreground: 'var(--color-accent)' } }],
    })
  })

  it('registers imported grammars by immutable revision and resolves aliases to the latest one', async () => {
    const first = language('revision-1')
    const second = language('revision-2')

    setImportedPierreSyntaxResources([], [first])
    registerPendingPierreSyntaxResources()
    registerPendingPierreSyntaxResources()
    setImportedPierreSyntaxResources([], [second])
    registerPendingPierreSyntaxResources()

    expect(pierreMocks.registerCustomLanguage).toHaveBeenCalledTimes(2)
    expect(pierreLanguageId('acme-test')).toBe('openwaggle:acme-test:revision-2')
    expect(pierreLanguageId('acmetest')).toBe('openwaggle:acme-test:revision-2')
    const secondLoader = pierreMocks.registerCustomLanguage.mock.calls[1]?.[1]
    if (typeof secondLoader !== 'function') throw new Error('Expected a Pierre language loader.')
    await expect(secondLoader()).resolves.toMatchObject({
      default: [{ name: 'openwaggle:acme-test:revision-2', scopeName: 'source.acme-test' }],
    })
  })
})
