import { describe, expect, it } from 'vitest'

import { validatePackageReleaseGate } from '../package-release-gate'

describe('Package Release Gate', () => {
  const successfulRequiredChecks = {
    checkResult: 'success',
    commitPolicyResult: 'success',
    testResult: 'success',
  } as const

  it('requires every blocking check and additionally requires artifacts for Release Please PRs', () => {
    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        artifactResult: 'skipped',
        headRef: 'feature/docs',
        rehearsalResult: 'success',
      }),
    ).not.toThrow()

    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        artifactResult: 'skipped',
        headRef: 'release-please--branches--main--components--packages',
        rehearsalResult: 'success',
      }),
    ).toThrow('immutable package artifacts')

    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        artifactResult: 'success',
        headRef: 'feature/docs',
        rehearsalResult: 'failure',
      }),
    ).toThrow('rehearsal')
  })

  it.each([
    ['commit policy', { ...successfulRequiredChecks, commitPolicyResult: 'failure' }],
    ['typecheck and lint', { ...successfulRequiredChecks, checkResult: 'cancelled' }],
    ['unit and component tests', { ...successfulRequiredChecks, testResult: 'skipped' }],
  ])('fails when %s is not successful', (_name, results) => {
    expect(() =>
      validatePackageReleaseGate({
        ...results,
        artifactResult: 'skipped',
        headRef: 'feature/docs',
        rehearsalResult: 'success',
      }),
    ).toThrow('did not succeed')
  })
})
