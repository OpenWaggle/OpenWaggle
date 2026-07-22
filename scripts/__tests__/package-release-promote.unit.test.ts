import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assertPackageReleaseAttestationIdentity,
  packageReleaseAttestationVerificationArgs,
  releaseAssetRepairPlan,
} from '../package-release-artifact-contract'
import {
  promoteVerifiedPackageRelease,
  readPackageReleasePlan,
  verifyPackageReleasePublicationEnvironment,
} from '../package-release-promotion'
import type { PackageReleaseArtifactManifest } from '../package-release-promotion'
import type { PackageReleasePlan } from '../package-release-promotion'

const plan: PackageReleasePlan = {
  packages: [
    {
      key: 'extension-sdk',
      name: '@openwaggle/extension-sdk',
      packagePath: 'packages/extension-sdk',
      tag: 'extension-sdk-v0.1.1',
      version: '0.1.1',
    },
    {
      key: 'waggle-core',
      name: '@openwaggle/waggle-core',
      packagePath: 'packages/waggle-core',
      tag: 'waggle-core-v0.1.1',
      version: '0.1.1',
    },
    {
      dependency: '@openwaggle/extension-sdk',
      key: 'extension-react',
      name: '@openwaggle/extension-react',
      packagePath: 'packages/extension-react',
      tag: 'extension-react-v0.1.1',
      version: '0.1.1',
    },
    {
      dependency: '@openwaggle/waggle-core',
      key: 'pi-waggle',
      name: '@openwaggle/pi-waggle',
      packagePath: 'packages/pi-waggle',
      tag: 'pi-waggle-v0.1.1',
      version: '0.1.1',
    },
  ],
  schemaVersion: 1,
  sourceSha: 'source-sha',
  sourceTree: 'source-tree',
}

const manifest: PackageReleaseArtifactManifest = {
  packages: [
    {
      file: 'extension-sdk.tgz',
      integrity: 'sha512-sdk',
      key: 'extension-sdk',
      name: '@openwaggle/extension-sdk',
      releaseNotes: 'SDK notes',
      sha256: 'sdk',
      tag: 'extension-sdk-v0.1.1',
      version: '0.1.1',
    },
    {
      file: 'waggle-core.tgz',
      integrity: 'sha512-core',
      key: 'waggle-core',
      name: '@openwaggle/waggle-core',
      releaseNotes: 'Core notes',
      sha256: 'core',
      tag: 'waggle-core-v0.1.1',
      version: '0.1.1',
    },
    {
      dependency: { name: '@openwaggle/extension-sdk', version: '0.1.1' },
      file: 'extension-react.tgz',
      integrity: 'sha512-react',
      key: 'extension-react',
      name: '@openwaggle/extension-react',
      releaseNotes: 'React notes',
      sha256: 'react',
      tag: 'extension-react-v0.1.1',
      version: '0.1.1',
    },
    {
      dependency: { name: '@openwaggle/waggle-core', version: '0.1.1' },
      file: 'pi-waggle.tgz',
      integrity: 'sha512-pi',
      key: 'pi-waggle',
      name: '@openwaggle/pi-waggle',
      releaseNotes: 'Pi notes',
      sha256: 'pi',
      tag: 'pi-waggle-v0.1.1',
      version: '0.1.1',
    },
  ],
  schemaVersion: 1,
  sourceSha: 'source-sha',
  sourceTree: 'source-tree',
}

describe('package release promotion', () => {
  it('accepts an explicit recovery only for the exact planned release SHA on main', () => {
    expect(() =>
      verifyPackageReleasePublicationEnvironment(plan, {
        actionsIdTokenRequestToken: 'token',
        actionsIdTokenRequestUrl: 'https://token.actions.githubusercontent.com',
        eventName: 'workflow_dispatch',
        recoveryReleaseSha: 'source-sha',
        ref: 'refs/heads/main',
        sha: 'workflow-definition-sha',
      }),
    ).not.toThrow()

    expect(() =>
      verifyPackageReleasePublicationEnvironment(plan, {
        actionsIdTokenRequestToken: 'token',
        actionsIdTokenRequestUrl: 'https://token.actions.githubusercontent.com',
        eventName: 'workflow_dispatch',
        recoveryReleaseSha: 'different-release-sha',
        ref: 'refs/heads/main',
        sha: 'workflow-definition-sha',
      }),
    ).toThrow('does not match the triggering main commit')
  })

  it('binds provenance to the CI signer workflow and selected source run', () => {
    expect(
      packageReleaseAttestationVerificationArgs(
        '/artifacts/package.tgz',
        'OpenWaggle/OpenWaggle',
        'release-head',
      ),
    ).toEqual([
      'attestation',
      'verify',
      '/artifacts/package.tgz',
      '--repo',
      'OpenWaggle/OpenWaggle',
      '--signer-workflow',
      'OpenWaggle/OpenWaggle/.github/workflows/ci.yml',
      '--source-digest',
      'release-head',
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

    expect(() => assertPackageReleaseAttestationIdentity(verified, {
      repository: 'OpenWaggle/OpenWaggle',
      runId: '123',
      sourceSha: 'release-head',
    })).not.toThrow()
    expect(() => assertPackageReleaseAttestationIdentity(verified, {
      repository: 'OpenWaggle/OpenWaggle',
      runId: '124',
      sourceSha: 'release-head',
    })).toThrow('selected CI run')
  })

  it('rejects a base-only promotion plan loaded from disk', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-promotion-plan-'))
    const planPath = path.join(temporaryDirectory, 'plan.json')
    try {
      await writeFile(planPath, JSON.stringify({
        packages: [plan.packages[0]],
        schemaVersion: 1,
        sourceSha: 'source-sha',
        sourceTree: 'source-tree',
      }))

      await expect(readPackageReleasePlan(planPath)).rejects.toThrow(
        '@openwaggle/extension-sdk requires a coordinated @openwaggle/extension-react release',
      )
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('repairs missing GitHub Release assets and rejects unexpected durable state', () => {
    expect(
      releaseAssetRepairPlan(
        { tagName: 'extension-sdk-v0.1.1', assets: [{ name: 'extension-sdk.tgz' }] },
        'extension-sdk-v0.1.1',
        ['extension-sdk.tgz', 'release-artifacts.json'],
      ),
    ).toEqual({
      missingNames: ['release-artifacts.json'],
      presentNames: ['extension-sdk.tgz'],
    })

    expect(() =>
      releaseAssetRepairPlan(
        { tagName: 'extension-sdk-v0.1.1', assets: [{ name: 'unexpected.zip' }] },
        'extension-sdk-v0.1.1',
        ['extension-sdk.tgz', 'release-artifacts.json'],
      ),
    ).toThrow('unexpected or duplicate assets')
  })

  it('resumes exact packages, retries transient publish failures, and tags only after all npm versions are accepted', async () => {
    const events: string[] = []
    const registry = new Map([['@openwaggle/waggle-core@0.1.1', 'sha512-core']])
    let sdkPublishAttempts = 0
    const dependencies = {
      ensureGitHubRelease: vi.fn(async ({ artifact }: {
        readonly artifact: { readonly tag: string }
        readonly artifactRoot: string
        readonly sourceSha: string
      }) => {
        events.push(`release:${artifact.tag}`)
      }),
      ensureTag: vi.fn(async (tag: string) => {
        events.push(`tag:${tag}`)
      }),
      publish: vi.fn(async (artifact: { readonly name: string; readonly integrity: string }) => {
        events.push(`publish:${artifact.name}`)
        if (artifact.name === '@openwaggle/extension-sdk' && sdkPublishAttempts === 0) {
          sdkPublishAttempts += 1
          throw new Error('ETIMEDOUT')
        }
        registry.set(`${artifact.name}@0.1.1`, artifact.integrity)
      }),
      readRegistryIntegrity: vi.fn(async (name: string, version: string) =>
        registry.get(`${name}@${version}`) ?? null,
      ),
      sleep: vi.fn(async () => undefined),
    }

    await promoteVerifiedPackageRelease(plan, manifest, '/artifacts', dependencies)

    expect(dependencies.publish.mock.calls.map(([artifact]) => artifact.name)).toEqual([
      '@openwaggle/extension-sdk',
      '@openwaggle/extension-sdk',
      '@openwaggle/extension-react',
      '@openwaggle/pi-waggle',
    ])
    const firstTag = events.findIndex((event) => event.startsWith('tag:'))
    const lastPublish = events.findLastIndex((event) => event.startsWith('publish:'))
    expect(firstTag).toBeGreaterThan(lastPublish)
    expect(dependencies.ensureTag).toHaveBeenCalledTimes(4)
    expect(dependencies.ensureGitHubRelease).toHaveBeenCalledTimes(4)
  })

  it('fails closed when npm already contains different bytes', async () => {
    const ensureTag = vi.fn()

    await expect(
      promoteVerifiedPackageRelease(plan, manifest, '/artifacts', {
        ensureGitHubRelease: vi.fn(),
        ensureTag,
        publish: vi.fn(),
        readRegistryIntegrity: vi.fn(async () => 'sha512-different'),
        sleep: vi.fn(),
      }),
    ).rejects.toThrow('different integrity')

    expect(ensureTag).not.toHaveBeenCalled()
  })
})
