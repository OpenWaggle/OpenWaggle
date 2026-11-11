import { describe, expect, it, vi } from 'vitest'
import { assertNativeModulesLoad } from '../native-load-probe'

class FakeDatabase {
  public readonly close = vi.fn()
}

function fakeNativeModules() {
  return vi.fn((moduleName: string): unknown => {
    if (moduleName === 'better-sqlite3') return FakeDatabase
    if (moduleName === 'sharp') return { versions: {} }
    throw new Error(`Unexpected module ${moduleName}.`)
  })
}

describe('native load probe', () => {
  it('opens and closes an in-memory SQLite database under Node', () => {
    const loadModule = fakeNativeModules()
    assertNativeModulesLoad('node', loadModule)

    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(['better-sqlite3'])
  })

  it('also loads sharp under the desktop runtime', () => {
    const loadModule = fakeNativeModules()
    assertNativeModulesLoad('electron', loadModule)

    expect(loadModule).toHaveBeenCalledWith('sharp')
  })

  it('rejects a SQLite module that is not a database constructor', () => {
    const loadModule = vi.fn((): unknown => ({}))
    expect(() => assertNativeModulesLoad('node', loadModule)).toThrow()
  })
})
