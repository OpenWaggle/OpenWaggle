import { describe, expect, it } from 'vitest'

import { validatePackageReleaseGate } from '../package-release-gate'

describe('Package Release Gate', () => {
  const successfulRequiredChecks = {
    checkResult: 'success',
    commitPolicyResult: 'success',
    testResult: 'success',
  } as const

  it('requires every blocking check including the release candidate aggregator', () => {
    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        candidateResult: 'success',
        rehearsalResult: 'success',
      }),
    ).not.toThrow()

    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        candidateResult: 'failure',
        rehearsalResult: 'success',
      }),
    ).toThrow('package release candidate')

    expect(() =>
      validatePackageReleaseGate({
        ...successfulRequiredChecks,
        candidateResult: 'success',
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
        candidateResult: 'success',
        rehearsalResult: 'success',
      }),
    ).toThrow('did not succeed')
  })
})
