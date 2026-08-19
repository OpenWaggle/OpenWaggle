import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  derivePlacements,
  findNsisTemplates,
  parseDefinedMacros,
} from '../installer-hook-placements'

describe('parseDefinedMacros', () => {
  it('lists every macro the installer script defines, in file order', () => {
    const source = [
      '# a comment',
      '!macro customInstall',
      '  DetailPrint "installing"',
      '!macroend',
      '',
      '!macro customUnInstall',
      '!macroend',
    ].join('\n')

    expect(parseDefinedMacros(source)).toEqual(['customInstall', 'customUnInstall'])
  })

  it('ignores insertions, so only definitions are counted', () => {
    const source = ['!insertmacro customInstall', '!macro customHeader', '!macroend'].join('\n')

    expect(parseDefinedMacros(source)).toEqual(['customHeader'])
  })
})

describe('derivePlacements', () => {
  /*
   * These assertions are against electron-builder's own vendored templates, not against a table in
   * this repository. A hand-written table claimed `customUnInstallCheck` belonged in the uninstaller
   * pass; it is inserted in `include/installUtil.nsh`, which the installer entry point includes only
   * under `!ifndef BUILD_UNINSTALLER`. Real makensis proved the consequence: a hook calling the
   * wrong StrFunc variant compiled clean under the old harness and would have failed a release.
   * A test asserting the table against itself could not have caught that.
   */
  it('reads each hook pass and context out of the shipped templates', async () => {
    const templates = await findNsisTemplates(process.cwd())
    expect(templates).not.toBeNull()
    if (templates === null) return

    const placements = await derivePlacements(templates, [
      'customHeader',
      'preInit',
      'customInit',
      'customUnInit',
      'customInstall',
      'customUnInstall',
      'customUnInstallSection',
      'customUnInstallCheck',
      'customRemoveFiles',
    ])

    // The installer pass compiles these, whatever their name suggests.
    expect(placements.get('customUnInstallCheck')).toMatchObject({
      passes: ['installer'],
      context: 'function',
    })
    expect(placements.get('customInit')).toMatchObject({
      passes: ['installer'],
      context: 'function',
    })
    /*
     * Both passes. `installer.nsi` is compiled twice - once plainly, once with -DBUILD_UNINSTALLER -
     * and these hooks carry no pass guard, so a single boolean silently checked them in the installer
     * pass only, which is where a per-pass helper declaration would then fail a release.
     */
    expect(placements.get('customHeader')).toMatchObject({
      passes: ['installer', 'uninstaller'],
      context: 'top-level',
    })
    expect(placements.get('preInit')?.passes).toEqual(['installer', 'uninstaller'])
    expect(placements.get('customInstall')).toMatchObject({
      passes: ['installer'],
      context: 'section',
    })

    // The uninstaller pass compiles these.
    expect(placements.get('customUnInstall')).toMatchObject({
      passes: ['uninstaller'],
      context: 'section',
    })
    expect(placements.get('customRemoveFiles')).toMatchObject({
      passes: ['uninstaller'],
      context: 'section',
    })
    expect(placements.get('customUnInit')).toMatchObject({
      passes: ['uninstaller'],
      context: 'function',
    })
    // Inserted after SectionEnd on purpose, so the hook can declare its own Section.
    expect(placements.get('customUnInstallSection')).toMatchObject({
      passes: ['uninstaller'],
      context: 'top-level',
    })
  })

  it('reports a hook this electron-builder version never inserts', async () => {
    const templates = await findNsisTemplates(process.cwd())
    if (templates === null) return

    const placements = await derivePlacements(templates, ['someFutureHook'])

    expect(placements.get('someFutureHook')).toBeNull()
  })

  it('covers every hook the shipped installer script defines', async () => {
    // If a hook here had no placement the check would fail, so this also documents the real set.
    const templates = await findNsisTemplates(process.cwd())
    if (templates === null) return
    const macros = parseDefinedMacros(await readFile('build/installer.nsh', 'utf8'))

    expect(macros.length).toBeGreaterThan(0)
    for (const [, placement] of await derivePlacements(templates, macros)) {
      expect(placement).not.toBeNull()
    }
  })
})
