import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
import type { PackageReleasePlan } from './package-release-plan'

export type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
export type { PackageReleasePlan } from './package-release-plan'

/*
 * npm can take well over a minute to serve a version it has accepted: the 0.2.0 release
 * published each package, then saw `npm view` return 404 for about 90 seconds. Wait up to
 * ten minutes before treating an accepted publication as missing, because a retried
 * `npm publish` of the same version can never succeed.
 */
const ACCEPTANCE_ATTEMPTS = 60
const ACCEPTANCE_POLL_DELAY_MS = 10_000
const PUBLISH_ATTEMPTS = 3
const REGISTRY_READ_ATTEMPTS = 3
const REGISTRY_RETRY_DELAY_MS = 5_000
const TRANSIENT_RETRY_DELAY_MS = 10_000

export interface PackageReleasePublicationEnvironment {
  readonly actionsIdTokenRequestToken: string | undefined
  readonly actionsIdTokenRequestUrl: string | undefined
  readonly eventName: string | undefined
  readonly recoveryReleaseSha: string | undefined
  readonly ref: string | undefined
  readonly sha: string | undefined
}

export function verifyPackageReleasePublicationEnvironment(
  plan: Readonly<{ sourceSha: string }>,
  environment: PackageReleasePublicationEnvironment,
) {
  if (environment.ref !== 'refs/heads/main') {
    throw new Error('Package publication is allowed only from main.')
  }
  const expectedSourceSha =
    environment.eventName === 'push'
      ? environment.sha
      : environment.eventName === 'workflow_dispatch'
        ? environment.recoveryReleaseSha
        : undefined
  if (expectedSourceSha !== plan.sourceSha) {
    throw new Error('Package release plan does not match the triggering main commit.')
  }
  if (
    environment.actionsIdTokenRequestToken === undefined ||
    environment.actionsIdTokenRequestUrl === undefined
  ) {
    throw new Error('GitHub OIDC token request environment is unavailable.')
  }
}

export interface PackageReleasePromotionDependencies {
  readonly ensureGitHubRelease: (
    input: Readonly<{
      artifact: PackageReleaseArtifact
      artifactRoot: string
      sourceSha: string
    }>,
  ) => Promise<void>
  readonly ensureTag: (tag: string, sourceSha: string) => Promise<void>
  readonly publish: (artifact: PackageReleaseArtifact, tarballPath: string) => Promise<void>
  readonly readRegistryIntegrity: (name: string, version: string) => Promise<string | null>
  readonly sleep: (durationMs: number) => Promise<void>
}

interface ArtifactContractModule {
  readonly decodePackageReleaseArtifactManifest: (value: unknown) => PackageReleaseArtifactManifest
  readonly verifyReleaseArtifactFile: (
    artifactRoot: string,
    artifact: PackageReleaseArtifact,
  ) => Promise<string>
}

interface PlanModule {
  readonly decodePackageReleasePlan: (value: unknown) => PackageReleasePlan
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArtifactContractModule(value: unknown): value is ArtifactContractModule {
  return (
    isJsonObject(value) &&
    typeof value['decodePackageReleaseArtifactManifest'] === 'function' &&
    typeof value['verifyReleaseArtifactFile'] === 'function'
  )
}

function isPlanModule(value: unknown): value is PlanModule {
  return isJsonObject(value) && typeof value['decodePackageReleasePlan'] === 'function'
}

async function loadArtifactContractModule() {
  const moduleUrl = new URL('./package-release-artifact-contract.ts', import.meta.url).href
  const loaded: unknown = await import(moduleUrl)
  if (!isArtifactContractModule(loaded)) {
    throw new Error('Package release artifact contract module is invalid.')
  }
  return loaded
}

async function loadPlanModule() {
  const moduleUrl = new URL('./package-release-plan.ts', import.meta.url).href
  const loaded: unknown = await import(moduleUrl)
  if (!isPlanModule(loaded)) {
    throw new Error('Package release plan module is invalid.')
  }
  return loaded
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export async function readPackageReleasePlan(planPath: string) {
  const planModule = await loadPlanModule()
  return planModule.decodePackageReleasePlan(await readJson(planPath))
}

export async function verifyPromotionBundle(plan: PackageReleasePlan, artifactRoot: string) {
  const artifactContract = await loadArtifactContractModule()
  const manifest = artifactContract.decodePackageReleaseArtifactManifest(
    await readJson(path.join(artifactRoot, 'release-artifacts.json')),
  )
  const packageMismatch = plan.packages.some((plannedPackage, index) => {
    const artifact = manifest.packages[index]
    return (
      artifact === undefined ||
      artifact.key !== plannedPackage.key ||
      artifact.name !== plannedPackage.name ||
      artifact.tag !== plannedPackage.tag ||
      artifact.version !== plannedPackage.version
    )
  })
  if (
    manifest.sourceTree !== plan.sourceTree ||
    manifest.packages.length !== plan.packages.length ||
    packageMismatch
  ) {
    throw new Error('Package release artifact manifest does not match the source tree plan.')
  }
  const expectedFiles = new Set([
    'release-artifacts.json',
    ...manifest.packages.map(({ file }) => file),
  ])
  const actualFiles = await readdir(artifactRoot)
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((file) => !expectedFiles.has(file))
  ) {
    throw new Error('Package release artifact bundle contains unexpected files.')
  }
  for (const artifact of manifest.packages) {
    await artifactContract.verifyReleaseArtifactFile(artifactRoot, artifact)
  }
  return manifest
}

function isTransientPublicationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EPIPE|ETIMEDOUT|socket hang up|E(?:408|429|500|502|503|504)|\b(?:408|429|500|502|503|504)\b|network/i.test(
    message,
  )
}

async function readRegistryIntegrityWithRetry(
  name: string,
  version: string,
  dependencies: PackageReleasePromotionDependencies,
) {
  for (let attempt = 0; attempt < REGISTRY_READ_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.readRegistryIntegrity(name, version)
    } catch (error) {
      if (!isTransientPublicationFailure(error) || attempt + 1 >= REGISTRY_READ_ATTEMPTS) {
        throw error
      }
      await dependencies.sleep(REGISTRY_RETRY_DELAY_MS)
    }
  }
  throw new Error(`Unable to inspect ${name}@${version} on npm.`)
}

async function requireAcceptedRegistryArtifact(
  artifact: PackageReleaseArtifact,
  dependencies: PackageReleasePromotionDependencies,
) {
  for (let attempt = 0; attempt < ACCEPTANCE_ATTEMPTS; attempt += 1) {
    const integrity = await readRegistryIntegrityWithRetry(
      artifact.name,
      artifact.version,
      dependencies,
    )
    if (integrity === artifact.integrity) return
    if (integrity !== null) {
      throw new Error(`${artifact.name}@${artifact.version} has different integrity on npm.`)
    }
    if (attempt + 1 < ACCEPTANCE_ATTEMPTS) await dependencies.sleep(ACCEPTANCE_POLL_DELAY_MS)
  }
  throw new Error(`${artifact.name}@${artifact.version} was not accepted by npm in time.`)
}

async function publishOrResume(
  artifact: PackageReleaseArtifact,
  artifactRoot: string,
  dependencies: PackageReleasePromotionDependencies,
) {
  const existingIntegrity = await readRegistryIntegrityWithRetry(
    artifact.name,
    artifact.version,
    dependencies,
  )
  if (existingIntegrity !== null) {
    if (existingIntegrity !== artifact.integrity) {
      throw new Error(`${artifact.name}@${artifact.version} has different integrity on npm.`)
    }
    return
  }
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      await dependencies.publish(artifact, path.join(artifactRoot, artifact.file))
      await requireAcceptedRegistryArtifact(artifact, dependencies)
      return
    } catch (error) {
      const acceptedIntegrity = await readRegistryIntegrityWithRetry(
        artifact.name,
        artifact.version,
        dependencies,
      )
      if (acceptedIntegrity === artifact.integrity) return
      if (acceptedIntegrity !== null) {
        throw new Error(`${artifact.name}@${artifact.version} has different integrity on npm.`, {
          cause: error,
        })
      }
      if (!isTransientPublicationFailure(error) || attempt + 1 >= PUBLISH_ATTEMPTS) throw error
      await dependencies.sleep(TRANSIENT_RETRY_DELAY_MS)
    }
  }
}

export async function promoteVerifiedPackageRelease(
  plan: PackageReleasePlan,
  manifest: PackageReleaseArtifactManifest,
  artifactRoot: string,
  dependencies: PackageReleasePromotionDependencies,
) {
  for (const artifact of manifest.packages) {
    if (
      artifact.dependency !== undefined &&
      (await readRegistryIntegrityWithRetry(
        artifact.dependency.name,
        artifact.dependency.version,
        dependencies,
      )) === null
    ) {
      throw new Error(
        `${artifact.dependency.name}@${artifact.dependency.version} is unavailable for ${artifact.name}.`,
      )
    }
    await publishOrResume(artifact, artifactRoot, dependencies)
  }
  for (const artifact of manifest.packages) {
    await dependencies.ensureTag(artifact.tag, plan.sourceSha)
  }
  for (const artifact of manifest.packages) {
    await dependencies.ensureGitHubRelease({ artifact, artifactRoot, sourceSha: plan.sourceSha })
  }
}
