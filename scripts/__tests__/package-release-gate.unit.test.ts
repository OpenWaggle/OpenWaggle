import { describe, expect, it } from 'vitest'

import { validatePackageReleaseGate } from '../package-release-gate'

const ALL_SUCCESS = {
  candidateResult: 'success',
  changesResult: 'success',
  checkResult: 'success',
  commitPolicyResult: 'success',
  mcpConformanceResult: 'success',
  rehearsalPackageResult: 'success',
  rehearsalWebsiteResult: 'success',
  testIntegrationComponentResult: 'success',
  testUnitResult: 'success',
} as const

describe('Package Release Gate', () => {
  it('passes the full tier when every job succeeded', () => {
    expect(() => validatePackageReleaseGate({ results: ALL_SUCCESS, tier: 'full' })).not.toThrow()
  })

  it('passes the full tier when path-scoped rehearsals were skipped by an app-only merge result', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
        },
        tier: 'full',
      }),
    ).not.toThrow()
  })

  it('passes the fast tier when the path-scoped rehearsals were skipped', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
        },
        tier: 'fast',
      }),
    ).not.toThrow()
  })

  it('passes the release-pr tier when the app test suite is skipped on the version-bump PR', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          testUnitResult: 'skipped',
          testIntegrationComponentResult: 'skipped',
          mcpConformanceResult: 'skipped',
          changesResult: 'skipped',
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
        },
        tier: 'release-pr',
      }),
    ).not.toThrow()
  })

  it.each([
    ['full', 'changesResult', 'failure', 'changed-surface detection'],
    ['full', 'rehearsalPackageResult', 'failure', 'package consumer rehearsal'],
    ['full', 'rehearsalWebsiteResult', 'cancelled', 'website and docs rehearsal'],
    ['fast', 'testUnitResult', 'skipped', 'unit tests'],
    ['fast', 'candidateResult', 'failure', 'package release candidate'],
    ['release-pr', 'checkResult', 'failure', 'typecheck and lint'],
    ['release-pr', 'candidateResult', 'skipped', 'package release candidate'],
  ] as const)('fails on tier %s when %s is %s', (tier, job, result, label) => {
    expect(() =>
      validatePackageReleaseGate({
        results: { ...ALL_SUCCESS, [job]: result },
        tier,
      }),
    ).toThrow(label)
  })

  it('rejects a failed job even when the job is not required for the tier', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: { ...ALL_SUCCESS, rehearsalPackageResult: 'failure' },
        tier: 'fast',
      }),
    ).toThrow('package consumer rehearsal did not succeed: failure.')
  })

  it('fails the full tier when change detection broke and left the rehearsals unknown', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: { ...ALL_SUCCESS, changesResult: 'failure', rehearsalPackageResult: 'skipped' },
        tier: 'full',
      }),
    ).toThrow('changed-surface detection did not succeed: failure.')
  })

  it('rejects unknown tiers', () => {
    expect(() => validatePackageReleaseGate({ results: ALL_SUCCESS, tier: 'everything' })).toThrow(
      'Unknown package release gate tier',
    )
  })
})
