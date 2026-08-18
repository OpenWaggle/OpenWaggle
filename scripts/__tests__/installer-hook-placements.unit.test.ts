import { describe, expect, it } from 'vitest'
import {
  HOOK_PLACEMENTS,
  parseDefinedMacros,
  planHookInsertions,
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

describe('planHookInsertions', () => {
  it('places each hook where electron-builder inserts it', () => {
    /*
     * Placement is what makes the compile check meaningful: NSIS refuses installer-variant StrFunc
     * calls from an uninstall section, and a helper declared in one pass is unreferenced in the
     * other - both of which broke real releases.
     */
    const plan = planHookInsertions(['customHeader', 'customInstall', 'customUnInstall'])

    expect(plan.topLevel).toEqual(['customHeader'])
    expect(plan.installSection).toEqual(['customInstall'])
    expect(plan.uninstallSection).toEqual(['customUnInstall'])
    expect(plan.unmapped).toEqual([])
  })

  it('reports a macro it has no insertion point for instead of skipping it', () => {
    /*
     * The harness used to insert only customInstall and customUnInstall, so any other hook was
     * never compiled: an undeclared StrFunc call and a bogus instruction inside customHeader both
     * passed. An unknown hook must fail the check so this map gets extended.
     */
    const plan = planHookInsertions(['customInstall', 'someFutureHook'])

    expect(plan.unmapped).toEqual(['someFutureHook'])
  })

  it('covers the hooks electron-builder documents', () => {
    // A floor, so the map cannot quietly shrink back to the two hardcoded hooks.
    for (const hook of ['customHeader', 'preInit', 'customUnInit', 'customRemoveFiles']) {
      expect(HOOK_PLACEMENTS[hook]).toBeDefined()
    }
  })
})
