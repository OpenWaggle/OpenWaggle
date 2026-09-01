import { describe, expect, it } from 'vitest'

import { validatePackageReleaseGate } from '../package-release-gate'

const ALL_SUCCESS = {
  candidateResult: 'success',
  checkResult: 'success',
  commitPolicyResult: 'success',
  e2eLinuxResult: 'success',
  e2eMacosResult: 'success',
  e2eWindowsResult: 'success',
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

  it('passes the fast tier when queue-only jobs were skipped', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          e2eLinuxResult: 'skipped',
          e2eWindowsResult: 'skipped',
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
        },
        tier: 'fast',
      }),
    ).not.toThrow()
  })

  it('passes the push tier without E2E results', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          e2eLinuxResult: 'skipped',
          e2eMacosResult: 'skipped',
          e2eWindowsResult: 'skipped',
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
        },
        tier: 'fast-no-e2e',
      }),
    ).not.toThrow()
  })

  it('passes the visual tier when only the macOS E2E job ran', () => {
    expect(() =>
      validatePackageReleaseGate({
        results: {
          ...ALL_SUCCESS,
          checkResult: 'skipped',
          commitPolicyResult: 'skipped',
          candidateResult: 'skipped',
          e2eLinuxResult: 'skipped',
          e2eWindowsResult: 'skipped',
          mcpConformanceResult: 'skipped',
          rehearsalPackageResult: 'skipped',
          rehearsalWebsiteResult: 'skipped',
          testIntegrationComponentResult: 'skipped',
          testUnitResult: 'skipped',
        },
        tier: 'visual',
      }),
    ).not.toThrow()
  })

  it.each([
    ['full', 'e2eWindowsResult', 'failure', 'Electron E2E (Windows)'],
    ['full', 'rehearsalPackageResult', 'failure', 'package consumer rehearsal'],
    ['full', 'rehearsalWebsiteResult', 'cancelled', 'website and docs rehearsal'],
    ['fast', 'e2eMacosResult', 'skipped', 'Electron E2E (macOS)'],
    ['fast', 'candidateResult', 'failure', 'package release candidate'],
    ['fast-no-e2e', 'testUnitResult', 'cancelled', 'unit tests'],
    ['visual', 'e2eMacosResult', 'failure', 'Electron E2E (macOS)'],
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

  it('rejects unknown tiers', () => {
    expect(() => validatePackageReleaseGate({ results: ALL_SUCCESS, tier: 'everything' })).toThrow(
      'Unknown package release gate tier',
    )
  })
})
