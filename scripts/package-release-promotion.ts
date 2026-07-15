import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ACCEPTANCE_ATTEMPTS = 12
const PUBLISH_ATTEMPTS = 3
const REGISTRY_RETRY_DELAY_MS = 5_000
const TRANSIENT_RETRY_DELAY_MS = 10_000

export interface PackageReleasePlanItem {
  readonly dependency?: string
  readonly key: string
  readonly name: string
  readonly packagePath: string
  readonly tag: string
  readonly version: string
}

export interface PackageReleasePlan {
  readonly packages: readonly PackageReleasePlanItem[]
  readonly schemaVersion: 1
  readonly sourceSha: string
  readonly sourceTree: string
}

export interface PackageReleaseArtifact {
  readonly dependency?: Readonly<{ name: string; version: string }>
  readonly file: string
  readonly integrity: string
  readonly key: string
  readonly name: string
  readonly releaseNotes: string
  readonly sha256: string
  readonly tag: string
  readonly version: string
}

export interface PackageReleaseArtifactManifest {
  readonly packages: readonly PackageReleaseArtifact[]
  readonly schemaVersion: 1
  readonly sourceSha: string
  readonly sourceTree: string
}

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

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodePlanPackage(value: unknown): PackageReleasePlanItem {
  if (
    !isJsonObject(value) ||
    typeof value.key !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.packagePath !== 'string' ||
    typeof value.tag !== 'string' ||
    typeof value.version !== 'string' ||
    (value.dependency !== undefined && typeof value.dependency !== 'string')
  ) {
    throw new Error('Package release plan contains an invalid package.')
  }
  return {
    ...(value.dependency === undefined ? {} : { dependency: value.dependency }),
    key: value.key,
    name: value.name,
    packagePath: value.packagePath,
    tag: value.tag,
    version: value.version,
  }
}

function decodePlan(value: unknown): PackageReleasePlan {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.sourceSha !== 'string' ||
    typeof value.sourceTree !== 'string' ||
    !Array.isArray(value.packages)
  ) {
    throw new Error('Package release plan is invalid.')
  }
  return {
    packages: value.packages.map(decodePlanPackage),
    schemaVersion: 1,
    sourceSha: value.sourceSha,
    sourceTree: value.sourceTree,
  }
}

function decodeArtifact(value: unknown): PackageReleaseArtifact {
  if (
    !isJsonObject(value) ||
    typeof value.file !== 'string' ||
    typeof value.integrity !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.releaseNotes !== 'string' ||
    typeof value.sha256 !== 'string' ||
    typeof value.tag !== 'string' ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Package release artifact manifest contains an invalid package.')
  }
  let dependency: Readonly<{ name: string; version: string }> | undefined
  if (value.dependency !== undefined) {
    if (
      !isJsonObject(value.dependency) ||
      typeof value.dependency.name !== 'string' ||
      typeof value.dependency.version !== 'string'
    ) {
      throw new Error('Package release artifact dependency is invalid.')
    }
    dependency = { name: value.dependency.name, version: value.dependency.version }
  }
  return {
    ...(dependency === undefined ? {} : { dependency }),
    file: value.file,
    integrity: value.integrity,
    key: value.key,
    name: value.name,
    releaseNotes: value.releaseNotes,
    sha256: value.sha256,
    tag: value.tag,
    version: value.version,
  }
}

function decodeManifest(value: unknown): PackageReleaseArtifactManifest {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.sourceSha !== 'string' ||
    typeof value.sourceTree !== 'string' ||
    !Array.isArray(value.packages)
  ) {
    throw new Error('Package release artifact manifest is invalid.')
  }
  return {
    packages: value.packages.map(decodeArtifact),
    schemaVersion: 1,
    sourceSha: value.sourceSha,
    sourceTree: value.sourceTree,
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export async function readPackageReleasePlan(planPath: string) {
  return decodePlan(await readJson(planPath))
}

export async function verifyPromotionBundle(plan: PackageReleasePlan, artifactRoot: string) {
  const manifest = decodeManifest(await readJson(path.join(artifactRoot, 'release-artifacts.json')))
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
  return /EAI_AGAIN|ECONNRESET|ETIMEDOUT|E(?:502|503|504)|\b(?:502|503|504)\b|network/i.test(message)
}

async function requireAcceptedRegistryArtifact(
  artifact: PackageReleaseArtifact,
  dependencies: PackageReleasePromotionDependencies,
) {
  for (let attempt = 0; attempt < ACCEPTANCE_ATTEMPTS; attempt += 1) {
    const integrity = await dependencies.readRegistryIntegrity(artifact.name, artifact.version)
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
  const existingIntegrity = await dependencies.readRegistryIntegrity(artifact.name, artifact.version)
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
      const acceptedIntegrity = await dependencies.readRegistryIntegrity(artifact.name, artifact.version)
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
      await dependencies.readRegistryIntegrity(artifact.dependency.name, artifact.dependency.version) === null) {
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
