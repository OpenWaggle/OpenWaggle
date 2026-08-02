import { describe, expect, it } from 'vitest'
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForSession,
  normalizeWorktreePath,
  type SessionWorktreeRef,
} from '../worktree-cleanup'

describe('worktree cleanup', () => {
  describe('normalizeWorktreePath', () => {
    it('trims and nulls empty values', () => {
      expect(normalizeWorktreePath('  /a/b  ')).toBe('/a/b')
      expect(normalizeWorktreePath('   ')).toBeNull()
      expect(normalizeWorktreePath(null)).toBeNull()
      expect(normalizeWorktreePath(undefined)).toBeNull()
    })
  })

  describe('getOrphanedWorktreePathForSession', () => {
    const sessions: SessionWorktreeRef[] = [
      { sessionId: 's1', worktreePath: '/wt/s1' },
      { sessionId: 's2', worktreePath: '/wt/shared' },
      { sessionId: 's3', worktreePath: '/wt/shared' },
      { sessionId: 's4', worktreePath: null },
    ]

    it('returns the path when the session solely owns it', () => {
      expect(getOrphanedWorktreePathForSession(sessions, 's1')).toBe('/wt/s1')
    })

    it('returns null when another session shares the path', () => {
      expect(getOrphanedWorktreePathForSession(sessions, 's2')).toBeNull()
      expect(getOrphanedWorktreePathForSession(sessions, 's3')).toBeNull()
    })

    it('returns null for sessions without a worktree', () => {
      expect(getOrphanedWorktreePathForSession(sessions, 's4')).toBeNull()
    })

    it('returns null for unknown sessions', () => {
      expect(getOrphanedWorktreePathForSession(sessions, 'missing')).toBeNull()
    })

    it('treats whitespace-equivalent paths as shared', () => {
      const withWhitespace: SessionWorktreeRef[] = [
        { sessionId: 'a', worktreePath: '/wt/x' },
        { sessionId: 'b', worktreePath: '  /wt/x  ' },
      ]
      expect(getOrphanedWorktreePathForSession(withWhitespace, 'a')).toBeNull()
    })
  })

  describe('formatWorktreePathForDisplay', () => {
    it('returns the last path segment', () => {
      expect(formatWorktreePathForDisplay('/wt/repo/feature-x')).toBe('feature-x')
      expect(formatWorktreePathForDisplay('/wt/repo/feature-x/')).toBe('feature-x')
      expect(formatWorktreePathForDisplay('C:\\wt\\repo\\feature-x')).toBe('feature-x')
    })

    it('falls back to the trimmed input when no segment is present', () => {
      expect(formatWorktreePathForDisplay('/')).toBe('/')
    })
  })
})
