import type { GitChangedFile } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import {
  detectSourceControlProvider,
  parseAheadBehind,
  parseCount,
  toWorkingTree,
} from '../vcs-status-parse'

describe('vcs-status-parse', () => {
  describe('detectSourceControlProvider', () => {
    it('detects github over https and ssh', () => {
      expect(detectSourceControlProvider('https://github.com/o/r.git')).toEqual({
        id: 'github',
        host: 'github.com',
      })
      expect(detectSourceControlProvider('git@github.com:o/r.git')).toEqual({
        id: 'github',
        host: 'github.com',
      })
    })

    it('detects gitlab including self-hosted hosts', () => {
      expect(detectSourceControlProvider('https://gitlab.com/o/r.git')).toEqual({
        id: 'gitlab',
        host: 'gitlab.com',
      })
      expect(detectSourceControlProvider('git@gitlab.example.com:o/r.git')).toEqual({
        id: 'gitlab',
        host: 'gitlab.example.com',
      })
    })

    it('returns null for unknown or empty remotes', () => {
      expect(detectSourceControlProvider('https://bitbucket.org/o/r.git')).toBeNull()
      expect(detectSourceControlProvider('')).toBeNull()
      expect(detectSourceControlProvider(null)).toBeNull()
    })
  })

  describe('parseAheadBehind / parseCount', () => {
    it('parses left-right counts', () => {
      expect(parseAheadBehind('3\t2')).toEqual({ ahead: 3, behind: 2 })
      expect(parseAheadBehind('  0   5  ')).toEqual({ ahead: 0, behind: 5 })
    })

    it('defaults malformed counts to zero', () => {
      expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 })
      expect(parseCount('nope')).toBe(0)
      expect(parseCount(undefined)).toBe(0)
      expect(parseCount('-4')).toBe(0)
    })
  })

  describe('toWorkingTree', () => {
    it('maps changed files and totals insertions/deletions', () => {
      const changed: GitChangedFile[] = [
        {
          path: 'b.ts',
          status: 'modified',
          staged: false,
          unstaged: true,
          additions: 2,
          deletions: 1,
        },
        {
          path: 'a.ts',
          status: 'added',
          staged: true,
          unstaged: false,
          additions: 5,
          deletions: 0,
        },
      ]
      expect(toWorkingTree(changed)).toEqual({
        files: [
          { path: 'b.ts', insertions: 2, deletions: 1 },
          { path: 'a.ts', insertions: 5, deletions: 0 },
        ],
        insertions: 7,
        deletions: 1,
      })
    })

    it('returns empty totals for a clean tree', () => {
      expect(toWorkingTree([])).toEqual({ files: [], insertions: 0, deletions: 0 })
    })
  })
})
