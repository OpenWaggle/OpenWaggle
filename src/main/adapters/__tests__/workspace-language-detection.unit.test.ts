import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vscodeLanguageAssociation } from '../workspace-language-detection'

const REPEATED_BRACE_GROUPS = 25
const ASSOCIATION_STRESS_COUNT = 4_000
const SINGLE_BRACE_ALTERNATIVE_COUNT = 100_000
const SIMPLE_ASSOCIATION_STRESS_COUNT = 50_000

describe('workspace language detection', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-language-detection-'))
    await fs.mkdir(path.join(projectPath, '.vscode'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('bounds brace expansion and continues to later associations', async () => {
    const exponentialPattern = `${'{a,b}'.repeat(REPEATED_BRACE_GROUPS)}.never`
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          [exponentialPattern]: 'plaintext',
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it('rejects oversized raw globs before scanning brace alternatives', async () => {
    const oversizedPattern = `${'x'.repeat(5_000)}${'{a,b}'.repeat(REPEATED_BRACE_GROUPS)}.never`
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          [oversizedPattern]: 'plaintext',
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it('shares the brace expansion budget across the complete association scan', async () => {
    const expensiveAssociations = Object.fromEntries(
      Array.from({ length: ASSOCIATION_STRESS_COUNT }, (_, index) => [
        `${'{a,b}'.repeat(REPEATED_BRACE_GROUPS)}-${String(index)}.never`,
        'plaintext',
      ]),
    )
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          ...expensiveAssociations,
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it('bounds alternatives within a single brace group and continues to later associations', async () => {
    const alternatives = Array.from(
      { length: SINGLE_BRACE_ALTERNATIVE_COUNT },
      (_, index) => `x${String(index)}`,
    ).join(',')
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          [`{${alternatives}}.never`]: 'plaintext',
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it('bounds regex work across large lists of simple association patterns', async () => {
    const simpleAssociations = Object.fromEntries(
      Array.from({ length: SIMPLE_ASSOCIATION_STRESS_COUNT }, (_, index) => [
        `x${String(index)}`,
        'p',
      ]),
    )
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({ 'files.associations': simpleAssociations }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBeNull()
  })

  it('matches adversarial globstar patterns without regex backtracking', async () => {
    const adversarialPattern = `**/${'**a'.repeat(300)}b`
    const nestedCandidate = `${'a/'.repeat(150)}end.templ`
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({ 'files.associations': { [adversarialPattern]: 'plaintext' } }),
    )

    await expect(vscodeLanguageAssociation(projectPath, nestedCandidate)).resolves.toBeNull()
  })

  it.runIf(process.platform !== 'win32')(
    'rejects workspace settings symlinks before reading them',
    async () => {
      const outsidePath = path.join(projectPath, 'outside-settings.json')
      await fs.writeFile(
        outsidePath,
        JSON.stringify({ 'files.associations': { '*': 'plaintext' } }),
      )
      await fs.rm(path.join(projectPath, '.vscode', 'settings.json'), { force: true })
      await fs.symlink(outsidePath, path.join(projectPath, '.vscode', 'settings.json'))

      await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).rejects.toThrow(
        'regular non-symlink file',
      )
    },
  )

  it.runIf(process.platform !== 'win32')(
    'rejects settings reached through a directory symlink outside the project',
    async () => {
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-outside-settings-'))
      try {
        await fs.writeFile(
          path.join(outsideRoot, 'settings.json'),
          JSON.stringify({ 'files.associations': { '*': 'plaintext' } }),
        )
        await fs.rm(path.join(projectPath, '.vscode'), { recursive: true })
        await fs.symlink(outsideRoot, path.join(projectPath, '.vscode'))

        await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).rejects.toThrow(
          'inside the project root',
        )
      } finally {
        await fs.rm(outsideRoot, { recursive: true, force: true })
      }
    },
  )

  it('skips malformed character-class ranges and continues to later associations', async () => {
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({
        'files.associations': {
          '*.[z-a]': 'plaintext',
          '*.templ': 'html',
        },
      }),
    )

    await expect(vscodeLanguageAssociation(projectPath, 'page.templ')).resolves.toBe('html')
  })

  it.each(['file.test.js', 'file.test.ts'])(
    'preserves VS Code character-class associations for %s',
    async (filename) => {
      await fs.writeFile(
        path.join(projectPath, '.vscode', 'settings.json'),
        JSON.stringify({ 'files.associations': { '*.test.[jt]s': 'javascript' } }),
      )

      await expect(vscodeLanguageAssociation(projectPath, filename)).resolves.toBe('javascript')
    },
  )

  it.each([
    ['?.ts', '😀.ts'],
    ['[😀].ts', '😀.ts'],
  ])('matches %s against Unicode code points in %s', async (glob, filename) => {
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({ 'files.associations': { [glob]: 'typescript' } }),
    )

    await expect(vscodeLanguageAssociation(projectPath, filename)).resolves.toBe('typescript')
  })

  it('matches large character classes without scanning every member per candidate character', async () => {
    const members = Array.from({ length: 1_300 }, (_, index) =>
      String.fromCodePoint(0x1_000 + index * 2),
    ).join('')
    const filename = `${String.fromCodePoint(0x1_000 + 1_299 * 2)}.ts`
    await fs.writeFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      JSON.stringify({ 'files.associations': { [`[${members}].ts`]: 'typescript' } }),
    )

    await expect(vscodeLanguageAssociation(projectPath, filename)).resolves.toBe('typescript')
  })
})
