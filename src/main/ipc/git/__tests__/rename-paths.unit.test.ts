import { describe, expect, it } from 'vitest'
import { buildChangedFiles, parsePorcelain, renameSourcePath } from '../status-parse'

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
})
