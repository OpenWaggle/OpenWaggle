import { describe, expect, it } from 'vitest'
import {
  buildGitActionProgressStages,
  defaultBranchActionLabel,
  planStackedActionPhases,
  requiresDefaultBranchConfirmation,
  resolveAutoFeatureBranchName,
  resolveDefaultBranchActionDialogCopy,
  sanitizeFeatureBranchName,
  targetsDefaultRef,
} from '../git-stacked-action'

describe('git-stacked-action pure logic', () => {
  describe('sanitizeFeatureBranchName', () => {
    it('prefixes feature/ and slugifies', () => {
      expect(sanitizeFeatureBranchName('Fix toast copy')).toBe('feature/fix-toast-copy')
      expect(sanitizeFeatureBranchName('feature/refine-toolbar')).toBe('feature/refine-toolbar')
      expect(sanitizeFeatureBranchName('codex/session summary')).toBe('codex/session-summary')
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

  describe('targetsDefaultRef', () => {
    /*
     * A push follows the upstream mapping, so standing on `feature` with an upstream of `origin/main` writes
     * `main` - verified against real git, which reported `feature -> main`. Judging only the ref you are on waved
     * that straight through, which is exactly the push this confirmation exists to catch.
     */
    it('is true when a push would write the default branch from another ref', () => {
      expect(targetsDefaultRef({ isDefaultRef: false, pushTargetIsDefaultRef: true })).toBe(true)
    })

    it('is true when the current ref is the default branch', () => {
      expect(targetsDefaultRef({ isDefaultRef: true, pushTargetIsDefaultRef: false })).toBe(true)
    })

    it('is false only when neither end is the default branch', () => {
      expect(targetsDefaultRef({ isDefaultRef: false, pushTargetIsDefaultRef: false })).toBe(false)
    })
  })

  describe('defaultBranchActionLabel', () => {
    it('names the destination when a push would write elsewhere', () => {
      // "You are on feature" while the push updates main invites confirming the wrong thing.
      expect(
        defaultBranchActionLabel({
          isDefaultRef: false,
          pushTargetIsDefaultRef: true,
          pushTargetRef: 'main',
          refName: 'feature',
        }),
      ).toBe('main (tracked by feature)')
    })

    it('names the current ref when that is what would be written', () => {
      expect(
        defaultBranchActionLabel({
          isDefaultRef: true,
          pushTargetIsDefaultRef: true,
          pushTargetRef: 'main',
          refName: 'main',
        }),
      ).toBe('main')
    })
  })
})
