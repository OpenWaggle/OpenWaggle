import type { BrowserImportSource } from '@shared/types/browser-import'
import { describe, expect, it } from 'vitest'
import {
  browserImportBlockedAction,
  canCloseBrowserImportWizard,
  formatSkippedDomains,
  fullDiskAccessRecheckStep,
  guidedImportResultToStep,
  initialBrowserImportWizardStep,
  initialTargetSelection,
  refreshedBrowserImportSourceStep,
  refreshedSourceProfileDirectory,
  resolveWizardTarget,
} from '../browser-import-wizard-logic'

const readySource: BrowserImportSource = {
  id: 'chrome',
  name: 'Chrome',
  profiles: [
    { directory: 'Default', name: 'Personal', cookieCount: 12 },
    { directory: 'Profile 1', name: 'Work', cookieCount: 4 },
  ],
}

describe('browser import wizard logic', () => {
  it('starts at the first actionable screen for each source state', () => {
    expect(initialBrowserImportWizardStep(readySource)).toEqual({ step: 'configure' })
    expect(
      initialBrowserImportWizardStep({ ...readySource, unavailable: 'browser-running' }),
    ).toEqual({ step: 'quit' })
    expect(
      initialBrowserImportWizardStep({ ...readySource, unavailable: 'needs-full-disk-access' }),
    ).toEqual({ step: 'full-disk-access', resume: 'configure' })
    expect(
      initialBrowserImportWizardStep({ ...readySource, unavailable: 'permission-denied' }),
    ).toEqual({ step: 'blocked', reason: 'permission-denied' })
    expect(initialBrowserImportWizardStep({ ...readySource, profiles: [] })).toEqual({
      step: 'blocked',
      reason: 'unknown-source-profile',
    })
  })

  it('preserves source selection when refreshed and falls back when it disappears', () => {
    expect(refreshedSourceProfileDirectory('Profile 1', readySource)).toBe('Profile 1')
    expect(refreshedSourceProfileDirectory('Removed', readySource)).toBe('Default')
    expect(refreshedBrowserImportSourceStep(undefined)).toEqual({
      step: 'blocked',
      reason: 'unknown-source',
    })
    expect(
      fullDiskAccessRecheckStep({ ...readySource, unavailable: 'needs-full-disk-access' }),
    ).toEqual({ step: 'full-disk-access', resume: 'configure', checked: true })
  })

  it('resolves new and live existing targets without accepting a vanished profile', () => {
    const profiles = [{ id: 'work', name: 'Work' }]
    expect(initialTargetSelection(true, profiles)).toEqual({ kind: 'new' })
    expect(initialTargetSelection(false, profiles)).toEqual({
      kind: 'existing',
      profileId: 'work',
    })
    expect(resolveWizardTarget({ kind: 'new' }, 'profile-stable', profiles)).toEqual({
      kind: 'new',
      profileId: 'profile-stable',
    })
    expect(
      resolveWizardTarget({ kind: 'existing', profileId: 'work' }, 'unused', profiles),
    ).toEqual({ kind: 'existing', profileId: 'work' })
    expect(
      resolveWizardTarget({ kind: 'existing', profileId: 'removed' }, 'unused', profiles),
    ).toBeUndefined()
  })

  it('routes import outcomes and locks dismissal only during the write', () => {
    const done = guidedImportResultToStep({
      ok: true,
      result: { imported: 2, skipped: 1, skippedDomains: ['blocked.test'] },
      targetName: 'Chrome',
      createdProfile: { id: 'new', name: 'Chrome', kind: 'persistent' },
    })
    expect(done).toEqual({
      step: 'done',
      imported: 2,
      skipped: 1,
      skippedDomains: ['blocked.test'],
      targetName: 'Chrome',
      createdProfile: true,
    })
    expect(
      guidedImportResultToStep({ ok: false, reason: 'browser-running', message: 'quit' }),
    ).toEqual({ step: 'quit' })
    expect(
      guidedImportResultToStep({
        ok: false,
        reason: 'needs-full-disk-access',
        message: 'grant',
      }),
    ).toEqual({ step: 'full-disk-access', resume: 'import', checked: true })
    expect(canCloseBrowserImportWizard({ step: 'importing' })).toBe(false)
    expect(canCloseBrowserImportWizard(done)).toBe(true)
  })

  it('provides a useful recovery path for transient and selection failures', () => {
    expect(browserImportBlockedAction('needs-keychain-approval')).toBe('retry')
    expect(browserImportBlockedAction('permission-denied')).toBe('retry')
    expect(browserImportBlockedAction('profile-limit-reached')).toBe('configure')
    expect(browserImportBlockedAction('unknown-source-profile')).toBe('refresh')
    expect(browserImportBlockedAction('unsupported-platform')).toBe('none')
    expect(browserImportBlockedAction('profile-cleanup-failed')).toBe('none')
  })

  it('keeps skipped-domain summaries compact', () => {
    expect(formatSkippedDomains([])).toBe('')
    expect(formatSkippedDomains(['one.test'])).toBe('one.test')
    expect(formatSkippedDomains(['one.test', 'two.test'])).toBe('one.test and two.test')
    expect(formatSkippedDomains(['a.test', 'b.test', 'c.test', 'd.test', 'e.test'])).toBe(
      'a.test, b.test, c.test and 2 more',
    )
  })
})
