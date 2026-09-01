import type { GitChangedFile } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import {
  detectSourceControlProvider,
  parseAheadBehind,
  parseCount,
  parseRemoteRepositoryIdentity,
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

    it('classifies by hostname while preserving explicit ports', () => {
      expect(detectSourceControlProvider('https://gitlab.example.com:8443/o/r.git')).toEqual({
        id: 'gitlab',
        host: 'gitlab.example.com',
      })
      expect(detectSourceControlProvider('ssh://git@github.enterprise.com:2222/o/r.git')).toEqual({
        id: 'github',
        host: 'github.enterprise.com',
      })
    })
  })

  describe('parseRemoteRepositoryIdentity', () => {
    it.each([
      ['git@github.com:contributor/project.git', 'contributor'],
      ['https://github.com/contributor/project.git', 'contributor'],
      ['ssh://git@github.example.com/contributor/project.git', 'contributor'],
    ])('extracts the pushed repository identity from %s', (remote, owner) => {
      expect(parseRemoteRepositoryIdentity(remote)).toMatchObject({
        provider: 'github',
        owner,
        repository: 'project',
      })
    })

    it('does not invent an owner for a local bare remote', () => {
      expect(parseRemoteRepositoryIdentity('/tmp/project.git')).toBeNull()
    })

    it('preserves a non-default enterprise URL port in the authority', () => {
      expect(
        parseRemoteRepositoryIdentity('ssh://git@github.example.com:8443/team/project.git'),
      ).toMatchObject({ authority: 'github.example.com:8443' })
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
