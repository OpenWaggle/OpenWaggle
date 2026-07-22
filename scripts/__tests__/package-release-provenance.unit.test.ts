import { describe, expect, it } from 'vitest'

import {
  assertPackageReleaseAttestationIdentity,
  assertPackageReleaseAttestationSourceCommit,
  packageReleaseAttestationVerificationArgs,
} from '../package-release-provenance'

const PULL_REQUEST_SOURCE_IDENTITY = {
  attestationSourceSha: 'pull-request-merge-sha',
  candidateSourceSha: 'release-head',
  sourceTree: 'source-tree',
} as const

describe('package release provenance', () => {
  it('binds verification to the CI signer workflow and selected run', () => {
    expect(
      packageReleaseAttestationVerificationArgs(
        '/artifacts/package.tgz',
        'OpenWaggle/OpenWaggle',
      ),
    ).toEqual([
      'attestation',
      'verify',
      '/artifacts/package.tgz',
      '--repo',
      'OpenWaggle/OpenWaggle',
      '--signer-workflow',
      'OpenWaggle/OpenWaggle/.github/workflows/ci.yml',
      '--deny-self-hosted-runners',
      '--format',
      'json',
    ])

    const verified = [{
      verificationResult: {
        signature: {
          certificate: {
            buildConfigURI: 'https://github.com/OpenWaggle/OpenWaggle/.github/workflows/ci.yml@refs/pull/135/merge',
            runInvocationURI: 'https://github.com/OpenWaggle/OpenWaggle/actions/runs/123/attempts/2',
            runnerEnvironment: 'github-hosted',
            sourceRepositoryDigest: 'release-head',
          },
        },
      },
    }]

    expect(assertPackageReleaseAttestationIdentity(verified, {
      repository: 'OpenWaggle/OpenWaggle',
      runId: '123',
    })).toBe('release-head')
    expect(() => assertPackageReleaseAttestationIdentity(verified, {
      repository: 'OpenWaggle/OpenWaggle',
      runId: '124',
    })).toThrow('selected CI run')
  })

  it('accepts the exact pull-request merge commit and direct candidate commit', () => {
    expect(() => assertPackageReleaseAttestationSourceCommit(
      {
        parents: [{ sha: 'base-sha' }, { sha: 'release-head' }],
        sha: 'pull-request-merge-sha',
        tree: { sha: 'source-tree' },
      },
      PULL_REQUEST_SOURCE_IDENTITY,
    )).not.toThrow()

    expect(() => assertPackageReleaseAttestationSourceCommit(
      {
        parents: [{ sha: 'base-sha' }],
        sha: 'release-head',
        tree: { sha: 'source-tree' },
      },
      {
        attestationSourceSha: 'release-head',
        candidateSourceSha: 'release-head',
        sourceTree: 'source-tree',
      },
    )).not.toThrow()
  })

  it('rejects a merge without the candidate parent or exact source tree', () => {
    expect(() => assertPackageReleaseAttestationSourceCommit(
      {
        parents: [{ sha: 'base-sha' }, { sha: 'different-head' }],
        sha: 'pull-request-merge-sha',
        tree: { sha: 'source-tree' },
      },
      PULL_REQUEST_SOURCE_IDENTITY,
    )).toThrow('candidate head and source tree')

    expect(() => assertPackageReleaseAttestationSourceCommit(
      {
        parents: [{ sha: 'base-sha' }, { sha: 'release-head' }],
        sha: 'pull-request-merge-sha',
        tree: { sha: 'different-tree' },
      },
      PULL_REQUEST_SOURCE_IDENTITY,
    )).toThrow('candidate head and source tree')
  })
})
