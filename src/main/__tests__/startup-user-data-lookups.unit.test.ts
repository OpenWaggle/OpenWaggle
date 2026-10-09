import { afterEach, describe, expect, it, vi } from 'vitest'

/** Paths whose default Electron creates on first lookup, under ~/Library/Application Support. */
const CREATED_ON_LOOKUP = new Set(['userData', 'sessionData', 'crashDumps'])

const mocks = vi.hoisted(async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const path = await import('node:path')
  // Every name main-process code imports from 'electron', so the mock can name each export.
  const names = new Set(['app', 'default'])
  const sourceRoot = path.resolve(import.meta.dirname, '..')
  for (const entry of readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || entry.includes('__tests__')) continue
    const source = readFileSync(path.join(sourceRoot, entry), 'utf8')
    for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'electron'/g)) {
      for (const name of (match[1] ?? '').split(',')) {
        const imported = name
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
        if (imported) names.add(imported)
      }
    }
  }
  return { names: [...names], getPath: vi.fn((name: string) => `/tmp/openwaggle-${name}`) }
})

vi.mock('electron', async () => {
  const { names, getPath } = await mocks
  // The startup modules read many Electron exports; each is an inert stand-in except app.getPath.
  const inert: object = new Proxy(function inertElectronValue() {}, {
    get: (_target, property) => (property === 'then' ? undefined : inert),
    apply: () => inert,
    construct: () => inert,
  })
  const app = new Proxy(
    { getPath, isPackaged: false },
    {
      get: (target, property) =>
        property in target ? Reflect.get(target, property) : Reflect.get(inert, property),
    },
  )
  return Object.fromEntries(
    names.map((name) => [name, name === 'app' ? app : name === 'default' ? { app } : inert]),
  )
})

// It imports electron natively, past the mock above.
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
}))

/*
 * Electron creates the default userData folder the first time it is looked up, so a lookup made
 * while modules load, before configureAppStoragePaths applies OPENWAGGLE_USER_DATA_DIR, left an
 * empty "~/Library/Application Support/<app name>" behind every overridden profile (QA, tests).
 */
describe('Main process startup imports', () => {
  afterEach(async () => {
    ;(await mocks).getPath.mockClear()
  })

  it('look up no folder Electron creates by default while they load', async () => {
    await import('../application-protocols')

    const lookups = (await mocks).getPath.mock.calls.map(([name]) => name)
    expect(lookups.filter((name) => CREATED_ON_LOOKUP.has(name))).toEqual([])
  })
})
