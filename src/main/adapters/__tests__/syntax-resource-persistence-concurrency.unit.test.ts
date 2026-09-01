import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

describe('syntax resource persistence concurrency', () => {
  let temporaryRoot = ''
  let resourcesDirectory = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-syntax-concurrency-'))
    resourcesDirectory = path.join(temporaryRoot, 'installed')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('serializes apply and remove operations for the same resource directory', async () => {
    const firstPath = path.join(temporaryRoot, 'first.json')
    const secondPath = path.join(temporaryRoot, 'second.json')
    await fs.writeFile(firstPath, JSON.stringify(theme('First', '#111111')))
    await fs.writeFile(secondPath, JSON.stringify(theme('Second', '#222222')))
    const firstCatalog = await parseSyntaxThemeSource(firstPath, 'user')
    const secondCatalog = await parseSyntaxThemeSource(secondPath, 'user')
    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'first',
      sourcePath: firstPath,
      ...firstCatalog,
      replacements: [],
      warnings: [],
    })
    const firstId = firstCatalog.themes[0]?.id
    if (!firstId) throw new Error('Expected the first imported theme identity.')

    const copyCompleted = Promise.withResolvers<void>()
    const continueApply = Promise.withResolvers<void>()
    const originalCopy = fs.cp.bind(fs)
    vi.spyOn(fs, 'cp').mockImplementation(async (source, destination, options) => {
      await originalCopy(source, destination, options)
      copyCompleted.resolve()
      await continueApply.promise
    })

    const applyPromise = applySyntaxThemePreview(resourcesDirectory, {
      token: 'second',
      sourcePath: secondPath,
      ...secondCatalog,
      replacements: [],
      warnings: [],
    })
    await copyCompleted.promise
    const removePromise = removeInstalledSyntaxTheme(resourcesDirectory, firstId)
    continueApply.resolve()
    await Promise.all([applyPromise, removePromise])

    await expect(listInstalledSyntaxThemes(resourcesDirectory)).resolves.toMatchObject({
      themes: [{ label: 'Second' }],
    })
  })

  it('serializes catalog reads with resource-directory mutations', async () => {
    const firstPath = path.join(temporaryRoot, 'first.json')
    const secondPath = path.join(temporaryRoot, 'second.json')
    await fs.writeFile(firstPath, JSON.stringify(theme('First', '#111111')))
    await fs.writeFile(secondPath, JSON.stringify(theme('Second', '#222222')))
    const firstCatalog = await parseSyntaxThemeSource(firstPath, 'user')
    const secondCatalog = await parseSyntaxThemeSource(secondPath, 'user')
    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'first',
      sourcePath: firstPath,
      ...firstCatalog,
      replacements: [],
      warnings: [],
    })

    const copyCompleted = Promise.withResolvers<void>()
    const continueApply = Promise.withResolvers<void>()
    const originalCopy = fs.cp.bind(fs)
    vi.spyOn(fs, 'cp').mockImplementation(async (source, destination, options) => {
      await originalCopy(source, destination, options)
      copyCompleted.resolve()
      await continueApply.promise
    })

    const applyPromise = applySyntaxThemePreview(resourcesDirectory, {
      token: 'second',
      sourcePath: secondPath,
      ...secondCatalog,
      replacements: [],
      warnings: [],
    })
    await copyCompleted.promise
    let listSettled = false
    const listPromise = listInstalledSyntaxThemes(resourcesDirectory).finally(() => {
      listSettled = true
    })
    await Promise.resolve()
    expect(listSettled).toBe(false)

    continueApply.resolve()
    await applyPromise
    const listed = await listPromise
    expect(listed.themes.map((resource) => resource.label).sort()).toEqual(['First', 'Second'])
  })

  it('retains and reports the backup when installation and rollback both fail', async () => {
    const firstPath = path.join(temporaryRoot, 'first.json')
    const replacementPath = path.join(temporaryRoot, 'replacement.json')
    await fs.writeFile(firstPath, JSON.stringify(theme('First', '#111111')))
    await fs.writeFile(replacementPath, JSON.stringify(theme('Replacement', '#222222')))
    const firstCatalog = await parseSyntaxThemeSource(firstPath, 'user')
    const replacementCatalog = await parseSyntaxThemeSource(replacementPath, 'user')
    await applySyntaxThemePreview(resourcesDirectory, {
      token: 'first',
      sourcePath: firstPath,
      ...firstCatalog,
      replacements: [],
      warnings: [],
    })

    const originalRename = fs.rename.bind(fs)
    let backupDirectory = ''
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const sourcePath = String(source)
      const destinationPath = String(destination)
      if (
        sourcePath === resourcesDirectory &&
        destinationPath.startsWith(`${resourcesDirectory}.backup-`)
      ) {
        backupDirectory = destinationPath
        await originalRename(source, destination)
        return
      }
      if (
        sourcePath.startsWith(`${resourcesDirectory}.staging-`) &&
        destinationPath === resourcesDirectory
      ) {
        throw new Error('simulated installation failure')
      }
      if (sourcePath === backupDirectory && destinationPath === resourcesDirectory) {
        throw new Error('simulated rollback failure')
      }
      await originalRename(source, destination)
    })

    await expect(
      applySyntaxThemePreview(resourcesDirectory, {
        token: 'replacement',
        sourcePath: replacementPath,
        ...replacementCatalog,
        replacements: [],
        warnings: [],
      }),
    ).rejects.toThrow('previous library was retained at')

    expect(backupDirectory).not.toBe('')
    await expect(listInstalledSyntaxThemes(backupDirectory)).resolves.toMatchObject({
      themes: [{ label: 'First' }],
    })
  })
})
