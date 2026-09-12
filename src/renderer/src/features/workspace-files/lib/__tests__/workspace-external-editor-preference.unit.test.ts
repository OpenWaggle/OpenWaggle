import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  openAbsoluteFileInPreferredWorkspaceEditor,
  readPreferredWorkspaceExternalEditor,
  resolveAndPersistPreferredWorkspaceExternalEditor,
  writePreferredWorkspaceExternalEditor,
} from '../workspace-external-editor-preference'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return fromPartial<Storage>({
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue
    },
  })
}

describe('workspace external editor preference', () => {
  it('round-trips a supported editor id', () => {
    const storage = memoryStorage()
    writePreferredWorkspaceExternalEditor(storage, 'vscode')

    expect(readPreferredWorkspaceExternalEditor(storage)).toBe('vscode')
  })

  it('ignores stale or malformed values', () => {
    const storage = fromPartial<Storage>({
      getItem: () => 'system-default',
    })

    expect(readPreferredWorkspaceExternalEditor(storage)).toBeNull()
  })

  it('fails soft when storage is unavailable', () => {
    const storage = fromPartial<Storage>({
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })

    expect(readPreferredWorkspaceExternalEditor(storage)).toBeNull()
    expect(() => writePreferredWorkspaceExternalEditor(storage, 'zed')).not.toThrow()
  })

  it('keeps an available stored editor and otherwise persists the first available editor', () => {
    const stored = memoryStorage('zed')
    const stale = memoryStorage('vscode')
    const editors = [
      { id: 'cursor', label: 'Cursor' },
      { id: 'zed', label: 'Zed' },
    ] as const

    expect(resolveAndPersistPreferredWorkspaceExternalEditor(stored, editors)).toBe('zed')
    expect(resolveAndPersistPreferredWorkspaceExternalEditor(stale, editors)).toBe('cursor')
    expect(readPreferredWorkspaceExternalEditor(stale)).toBe('cursor')
  })

  it('opens an absolute target in the inferred editor without losing line or column', async () => {
    const openAbsoluteFileExternal = vi.fn(async () => undefined)
    const storage = memoryStorage('missing-editor')

    await openAbsoluteFileInPreferredWorkspaceEditor({
      api: {
        listWorkspaceExternalEditors: async () => [{ id: 'cursor', label: 'Cursor' }],
        openAbsoluteFileExternal,
      },
      storage,
      path: '/Users/tester/.config/tool/settings.ts',
      line: 12,
      column: 4,
    })

    expect(openAbsoluteFileExternal).toHaveBeenCalledExactlyOnceWith({
      path: '/Users/tester/.config/tool/settings.ts',
      editor: 'cursor',
      line: 12,
      column: 4,
    })
    expect(readPreferredWorkspaceExternalEditor(storage)).toBe('cursor')
  })

  it('reports when no supported editor is installed', async () => {
    await expect(
      openAbsoluteFileInPreferredWorkspaceEditor({
        api: {
          listWorkspaceExternalEditors: async () => [],
          openAbsoluteFileExternal: vi.fn(),
        },
        storage: memoryStorage(),
        path: '/tmp/example.ts',
        line: null,
        column: null,
      }),
    ).rejects.toThrow('No supported editor is available')
  })
})
