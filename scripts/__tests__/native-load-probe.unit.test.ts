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
  it('opens and closes an in-memory SQLite database, then loads sharp', () => {
    const loadModule = fakeNativeModules()
    assertNativeModulesLoad(loadModule)

    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(['better-sqlite3', 'sharp'])
  })

  it('rejects a SQLite module that is not a database constructor', () => {
    const loadModule = vi.fn((): unknown => ({}))
    expect(() => assertNativeModulesLoad(loadModule)).toThrow()
  })
})
