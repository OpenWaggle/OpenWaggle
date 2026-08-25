import { describe, expect, it } from 'vitest'
import {
  buildChangedFiles,
  normalizeGitPath,
  parsePorcelain,
  renameSourcePath,
} from '../status-parse'

describe('renameSourcePath', () => {
  it('reads the source out of both porcelain rename spellings', () => {
    /*
     * A pathspec commit covers exactly the paths it is given. Reporting a rename under its target
     * only meant the staged deletion of the source was left behind, so the commit contained both
     * files - verified against real git.
     */
    expect(renameSourcePath('old.txt -> new.txt')).toBe('old.txt')
    expect(renameSourcePath('dir/{old => new}.ts')).toBe('dir/old.ts')
    expect(renameSourcePath('plain.txt')).toBeNull()
    expect(renameSourcePath('')).toBeNull()
  })
})

describe('buildChangedFiles', () => {
  it('carries the rename source through to the changed file', () => {
    const entries = parsePorcelain('R  old.txt -> new.txt\n')
    const files = buildChangedFiles(entries, new Map())

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      path: 'new.txt',
      status: 'renamed',
      renamedFrom: 'old.txt',
    })
  })

  it('leaves renamedFrom absent for an ordinary change', () => {
    const files = buildChangedFiles(parsePorcelain(' M src/app.ts\n'), new Map())

    expect(files[0]).not.toHaveProperty('renamedFrom')
  })

  it('does not invent a rename for an ordinary file whose name contains " -> "', () => {
    /*
     * The source path was read from any entry containing ` -> `, so a real file called
     * `weird -> name.txt` had its path truncated to `weird` and a phantom source invented - which
     * would then be staged and committed. Only R and C status codes describe a rename or copy.
     */
    const files = buildChangedFiles(parsePorcelain(' M weird -> name.txt\n'), new Map())

    expect(files[0]).toMatchObject({ path: 'weird -> name.txt' })
    expect(files[0]).not.toHaveProperty('renamedFrom')
  })

  it('normalises a brace rename that removes a path component', () => {
    /*
     * git compacts such a rename as `dir/{sub => }/file.ts`. Substituting the second half left
     * `dir//file.ts`, which matches no porcelain path, so the numstat line's stats were attached to a
     * phantom entry instead of the file that changed.
     */
    expect(normalizeGitPath('dir/{sub => }/file.ts')).toBe('dir/file.ts')
    expect(normalizeGitPath('dir/{old => new}/file.ts')).toBe('dir/new/file.ts')
  })
})
