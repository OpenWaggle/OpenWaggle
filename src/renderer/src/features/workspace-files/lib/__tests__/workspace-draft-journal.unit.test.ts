import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  draftStorageKey,
  readDraftJournal,
  removeWorkspaceDraftJournals,
  retargetWorkspaceDraftJournals,
} from '../workspace-draft-journal'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('workspace draft journal path changes', () => {
  const storage = new MemoryStorage()

  afterEach(() => {
    storage.clear()
    vi.restoreAllMocks()
  })

  it('retargets one file without touching an identical path in another worktree', () => {
    storage.setItem(draftStorageKey('/worktree-a', 'src/a.ts'), 'a')
    storage.setItem(draftStorageKey('/worktree-b', 'src/a.ts'), 'b')

    retargetWorkspaceDraftJournals(storage, '/worktree-a', 'src/a.ts', 'src/b.ts')

    expect(storage.getItem(draftStorageKey('/worktree-a', 'src/a.ts'))).toBeNull()
    expect(storage.getItem(draftStorageKey('/worktree-a', 'src/b.ts'))).toBe('a')
    expect(storage.getItem(draftStorageKey('/worktree-b', 'src/a.ts'))).toBe('b')
  })

  it('retargets and removes every journal beneath a moved directory', () => {
    storage.setItem(draftStorageKey('/project', 'src/a.ts'), 'a')
    storage.setItem(draftStorageKey('/project', 'src/nested/b.ts'), 'b')
    storage.setItem(draftStorageKey('/project', 'tests/a.ts'), 'test')

    retargetWorkspaceDraftJournals(storage, '/project', 'src', 'packages/app/src')
    expect(storage.getItem(draftStorageKey('/project', 'packages/app/src/a.ts'))).toBe('a')
    expect(storage.getItem(draftStorageKey('/project', 'packages/app/src/nested/b.ts'))).toBe('b')

    removeWorkspaceDraftJournals(storage, '/project', 'packages/app')
    expect(storage.getItem(draftStorageKey('/project', 'packages/app/src/a.ts'))).toBeNull()
    expect(storage.getItem(draftStorageKey('/project', 'tests/a.ts'))).toBe('test')
  })

  it('logs the affected file when a stored journal is malformed', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    storage.setItem(draftStorageKey('/project', 'src/file.ts'), '{')

    expect(readDraftJournal(storage, '/project', 'src/file.ts')).toBeNull()
    expect(warning).toHaveBeenCalledWith(
      '[workspace-draft-journal] Could not read a workspace draft journal',
      expect.objectContaining({ projectPath: '/project', path: 'src/file.ts' }),
    )
  })
})
