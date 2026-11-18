import { WorkingPath } from '@shared/types/brand'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCommitPaths } from '../useCommitPaths'

/*
 * The hook loads the status itself, so the answer has to come from the IPC boundary rather than a store seed -
 * the load would overwrite a seed immediately.
 */
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitStatus: vi.fn(async () => ({
      branch: 'main',
      clean: false,
      ahead: 0,
      behind: 0,
      additions: 1,
      deletions: 1,
      filesChanged: 2,
      changedFiles: [
        { path: 'src/new-name.ts', status: 'renamed', renamedFrom: 'src/old-name.ts' },
        { path: 'src/edited.ts', status: 'modified' },
      ],
    })),
  },
}))

const WORKING_PATH = WorkingPath('/repo')

/**
 * What the panel hands main to commit. Expanding a rename's source is deliberately not done here: `commitGit`
 * does it conditionally, skipping a source that something now occupies, because `git commit -- <paths>` commits
 * the working-tree content of the paths it is handed. Supplying it from here passed an occupied source through,
 * and main only ever adds to the caller's selection, so it could never be taken back out.
 */
describe('useCommitPaths', () => {
  it('hands over target paths only, leaving rename sources to main', async () => {
    const { result } = renderHook(() => useCommitPaths(WORKING_PATH, 0))

    await vi.waitFor(() => expect(result.current.paths).toHaveLength(2))

    expect(result.current.paths).toEqual(['src/new-name.ts', 'src/edited.ts'])
    // One rename is one changed file, whatever the pathspec ends up containing.
    expect(result.current.changedFileCount).toBe(2)
  })
})
