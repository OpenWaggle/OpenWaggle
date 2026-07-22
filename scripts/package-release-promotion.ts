import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
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
export type { PackageReleasePlan, PackageReleasePlanItem } from './package-release-plan'

const ACCEPTANCE_ATTEMPTS = 12
const PUBLISH_ATTEMPTS = 3
const REGISTRY_READ_ATTEMPTS = 3
const REGISTRY_RETRY_DELAY_MS = 5_000
const TRANSIENT_RETRY_DELAY_MS = 10_000

export interface PackageReleasePromotionDependencies {
  readonly ensureGitHubRelease: (input: Readonly<{
    artifact: PackageReleaseArtifact
    artifactRoot: string
    sourceSha: string
  }>) => Promise<void>
  readonly ensureTag: (tag: string, sourceSha: string) => Promise<void>
  readonly publish: (artifact: PackageReleaseArtifact, tarballPath: string) => Promise<void>
  readonly readRegistryIntegrity: (name: string, version: string) => Promise<string | null>
  readonly sleep: (durationMs: number) => Promise<void>
}

interface ArtifactContractModule {
  readonly decodePackageReleaseArtifactManifest: (
    value: unknown,
  ) => PackageReleaseArtifactManifest
}

interface PlanModule {
  readonly decodePackageReleasePlan: (value: unknown) => PackageReleasePlan
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArtifactContractModule(value: unknown): value is ArtifactContractModule {
  return isJsonObject(value) &&
    typeof value.decodePackageReleaseArtifactManifest === 'function'
}

function isPlanModule(value: unknown): value is PlanModule {
  return isJsonObject(value) && typeof value.decodePackageReleasePlan === 'function'
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
    return artifact === undefined || artifact.key !== plannedPackage.key ||
      artifact.name !== plannedPackage.name || artifact.tag !== plannedPackage.tag ||
      artifact.version !== plannedPackage.version
  })
  if (
    manifest.sourceTree !== plan.sourceTree ||
    manifest.packages.length !== plan.packages.length ||
    packageMismatch
  ) {
    throw new Error('Package release artifact manifest does not match the source tree plan.')
  }
  const expectedFiles = new Set(['release-artifacts.json', ...manifest.packages.map(({ file }) => file)])
  const actualFiles = await readdir(artifactRoot)
  if (actualFiles.length !== expectedFiles.size || actualFiles.some((file) => !expectedFiles.has(file))) {
    throw new Error('Package release artifact bundle contains unexpected files.')
  }
  for (const artifact of manifest.packages) {
    if (path.basename(artifact.file) !== artifact.file || !artifact.file.endsWith('.tgz')) {
      throw new Error(`${artifact.name} artifact filename is invalid.`)
    }
    const tarballPath = path.join(artifactRoot, artifact.file)
    if (!(await lstat(tarballPath)).isFile()) {
      throw new Error(`${artifact.name} artifact must be a regular file.`)
    }
    const contents = await readFile(tarballPath)
    if (createHash('sha256').update(contents).digest('hex') !== artifact.sha256) {
      throw new Error(`${artifact.name} artifact SHA-256 is invalid.`)
    }
    if (`sha512-${createHash('sha512').update(contents).digest('base64')}` !== artifact.integrity) {
      throw new Error(`${artifact.name} artifact npm integrity is invalid.`)
    }
  }
  return manifest
}

function isTransientPublicationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EPIPE|ETIMEDOUT|socket hang up|E(?:408|429|500|502|503|504)|\b(?:408|429|500|502|503|504)\b|network/i.test(message)
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
    if (attempt + 1 < ACCEPTANCE_ATTEMPTS) await dependencies.sleep(REGISTRY_RETRY_DELAY_MS)
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
        throw new Error(
          `${artifact.name}@${artifact.version} has different integrity on npm.`,
          { cause: error },
        )
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
    if (artifact.dependency !== undefined &&
      await readRegistryIntegrityWithRetry(
        artifact.dependency.name,
        artifact.dependency.version,
        dependencies,
      ) === null) {
      throw new Error(`${artifact.dependency.name}@${artifact.dependency.version} is unavailable for ${artifact.name}.`)
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
