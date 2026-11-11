import { describe, expect, it } from 'vitest'
import {
  applyElectronLocalStorageImport,
  ELECTRON_LOCAL_STORAGE_IMPORT_MARKER,
  electronLocalStorageImportFromArguments,
  electronLocalStorageImportRendererArguments,
  type ImportableStorage,
} from '../electron-local-storage-import'

function memoryStorage(initial: Record<string, string> = {}, quota = Number.POSITIVE_INFINITY) {
  const items = new Map(Object.entries(initial))
  const storage: ImportableStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (value.length > quota) throw new Error('QuotaExceededError')
      items.set(key, value)
    },
  }
  return { storage, items }
}

describe('applyElectronLocalStorageImport', () => {
  it('writes absent keys, keeps present ones, and records the import', () => {
    const { storage, items } = memoryStorage({ 'openwaggle:right-panel-width': '500' })
    const result = applyElectronLocalStorageImport(storage, {
      importId: 'import-1',
      entries: {
        'openwaggle:right-panel-width': '435',
        'openwaggle:hive-panel:v1': '{"view":"tree"}',
      },
    })
    expect(result).toEqual({
      importId: 'import-1',
      applied: 1,
      kept: 1,
      failed: 0,
      alreadyApplied: false,
    })
    expect(items.get('openwaggle:right-panel-width')).toBe('500')
    expect(items.get('openwaggle:hive-panel:v1')).toBe('{"view":"tree"}')
    expect(items.get(ELECTRON_LOCAL_STORAGE_IMPORT_MARKER)).toBe('import-1')
  })

  it('does nothing the second time for the same import', () => {
    const { storage, items } = memoryStorage()
    const payload = { importId: 'import-2', entries: { theme: 'dark' } }
    applyElectronLocalStorageImport(storage, payload)
    items.set('theme', 'light')
    expect(applyElectronLocalStorageImport(storage, payload).alreadyApplied).toBe(true)
    expect(items.get('theme')).toBe('light')
  })

  it('counts entries the storage quota rejects and still applies the rest', () => {
    const { storage, items } = memoryStorage({}, 10)
    const result = applyElectronLocalStorageImport(storage, {
      importId: 'import-3',
      entries: { small: 'ok', huge: 'x'.repeat(100) },
    })
    expect(result.applied).toBe(1)
    expect(result.failed).toBe(1)
    expect(items.has('huge')).toBe(false)
  })
})

describe('the localStorage import renderer argument', () => {
  it('round-trips an import through the renderer arguments', () => {
    const payload = { importId: 'import-1', entries: { theme: 'dark', 'a=b': '{"x":1}' } }
    const argv = ['--other', ...electronLocalStorageImportRendererArguments(payload)]
    expect(electronLocalStorageImportFromArguments(argv)).toEqual(payload)
  })

  it('passes nothing without an import, and ignores a malformed argument', () => {
    expect(electronLocalStorageImportRendererArguments(null)).toEqual([])
    expect(electronLocalStorageImportFromArguments([])).toBeNull()
    for (const malformed of [
      '{',
      '{"importId":1,"entries":{}}',
      '{"importId":"a","entries":{"k":2}}',
    ]) {
      expect(
        electronLocalStorageImportFromArguments([
          `--openwaggle-electron-local-storage-import=${malformed}`,
        ]),
      ).toBeNull()
    }
  })
})
