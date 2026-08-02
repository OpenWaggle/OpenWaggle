import { describe, expect, it } from 'vitest'
import {
  buildGitActionProgressStages,
  planStackedActionPhases,
  requiresDefaultBranchConfirmation,
  resolveAutoFeatureBranchName,
  resolveDefaultBranchActionDialogCopy,
  sanitizeFeatureBranchName,
} from '../git-stacked-action'

describe('git-stacked-action pure logic', () => {
  describe('sanitizeFeatureBranchName', () => {
    it('prefixes feature/ and slugifies', () => {
      expect(sanitizeFeatureBranchName('Fix toast copy')).toBe('feature/fix-toast-copy')
      expect(sanitizeFeatureBranchName('feature/refine-toolbar')).toBe('feature/refine-toolbar')
    })
  })

  describe('resolveAutoFeatureBranchName', () => {
    it('returns a unique name, suffixing on collision', () => {
      expect(resolveAutoFeatureBranchName(['main'], 'fix toast copy')).toBe(
        'feature/fix-toast-copy',
      )
      expect(resolveAutoFeatureBranchName(['feature/ticket-1'], 'feature/ticket-1')).toBe(
        'feature/ticket-1-2',
      )
      expect(resolveAutoFeatureBranchName(['main'])).toBe('feature/update')
    })
  })

  describe('buildGitActionProgressStages', () => {
    it('sequences commit_push_pr stages with a feature branch', () => {
      expect(
        buildGitActionProgressStages({
          action: 'commit_push_pr',
          hasCustomCommitMessage: true,
          hasWorkingTreeChanges: true,
          featureBranch: true,
        }),
      ).toEqual([
        'Preparing feature ref...',
        'Committing...',
        'Pushing...',
        'Preparing PR...',
        'Generating PR content...',
        'Creating pull request...',
      ])
    })

    it('returns a single stage for push and pull', () => {
      expect(
        buildGitActionProgressStages({
          action: 'push',
          hasCustomCommitMessage: false,
          hasWorkingTreeChanges: false,
        }),
      ).toEqual(['Pushing...'])
      expect(
        buildGitActionProgressStages({
          action: 'pull',
          hasCustomCommitMessage: false,
          hasWorkingTreeChanges: false,
        }),
      ).toEqual(['Pulling...'])
    })
  })

  describe('requiresDefaultBranchConfirmation', () => {
    it('confirms only mutating actions on the default ref', () => {
      expect(requiresDefaultBranchConfirmation('push', true)).toBe(true)
      expect(requiresDefaultBranchConfirmation('commit', true)).toBe(false)
      expect(requiresDefaultBranchConfirmation('push', false)).toBe(false)
    })
  })

  describe('resolveDefaultBranchActionDialogCopy', () => {
    it('uses provider terminology (MR for gitlab)', () => {
      const copy = resolveDefaultBranchActionDialogCopy({
        action: 'commit_push_pr',
        branchName: 'main',
        includesCommit: true,
        provider: 'gitlab',
      })
      expect(copy.title).toContain('MR')
      expect(copy.continueLabel).toContain('MR')
    })
  })

  describe('planStackedActionPhases', () => {
    it('orders phases per action', () => {
      expect(planStackedActionPhases('commit_push_pr')).toEqual(['commit', 'push', 'pr'])
      expect(planStackedActionPhases('create_pr')).toEqual(['push', 'pr'])
      expect(planStackedActionPhases('commit')).toEqual(['commit'])
    })
  })
})
