import { describe, expect, it } from 'vitest'

import { validatePackageReleaseCandidate } from '../package-release-candidate-gate'

describe('Package Release Candidate', () => {
  it('accepts an intentional artifact skip for ordinary pull requests', () => {
    expect(() =>
      validatePackageReleaseCandidate({
        artifactResult: 'skipped',
        classificationResult: 'success',
        headRef: 'fix/package-release-preflight',
      }),
    ).not.toThrow()
  })

  it('requires immutable artifacts for coordinated Release Please pull requests', () => {
    expect(() =>
      validatePackageReleaseCandidate({
        artifactResult: 'skipped',
        classificationResult: 'success',
        headRef: 'release-please--branches--main',
      }),
    ).toThrow('artifacts must be success')
  })

  it('does not trust branches that only imitate the coordinated branch prefix', () => {
    expect(() =>
      validatePackageReleaseCandidate({
        artifactResult: 'skipped',
        classificationResult: 'success',
        headRef: 'release-please--branches--main--imitation',
      }),
    ).not.toThrow()
  })

  it('fails closed when classification or ordinary-PR artifact execution drifts', () => {
    expect(() =>
      validatePackageReleaseCandidate({
        artifactResult: 'skipped',
        classificationResult: 'failure',
        headRef: 'fix/package-release-preflight',
      }),
    ).toThrow('classification did not succeed')

    expect(() =>
      validatePackageReleaseCandidate({
        artifactResult: 'success',
        classificationResult: 'success',
        headRef: 'fix/package-release-preflight',
      }),
    ).toThrow('artifacts must be skipped')
  })
})
