import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import type { PackageReleasePlan, PackageReleasePlanItem } from './package-release-plan'

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

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function releaseAssetRepairPlan(
  value: unknown,
  tag: string,
  expectedNames: readonly string[],
) {
  if (!isJsonObject(value) || value.tagName !== tag || !Array.isArray(value.assets)) {
    throw new Error(`GitHub Release ${tag} does not match its immutable tag and assets.`)
  }
  const assetNames = value.assets.map((asset) => {
    if (!isJsonObject(asset) || typeof asset.name !== 'string') {
      throw new Error(`GitHub Release ${tag} returned an invalid asset.`)
    }
    return asset.name
  })
  const uniqueNames = new Set(assetNames)
  if (
    uniqueNames.size !== assetNames.length ||
    assetNames.some((name) => !expectedNames.includes(name))
  ) {
    throw new Error(`GitHub Release ${tag} contains unexpected or duplicate assets.`)
  }
  return {
    missingNames: expectedNames.filter((name) => !uniqueNames.has(name)),
    presentNames: expectedNames.filter((name) => uniqueNames.has(name)),
  }
}

function decodeDependency(value: unknown) {
  if (
    !isJsonObject(value) ||
    typeof value.name !== 'string' ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Package release artifact manifest contains an invalid dependency.')
  }
  return { name: value.name, version: value.version }
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
  const dependency =
    value.dependency === undefined ? undefined : decodeDependency(value.dependency)
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

export function decodePackageReleaseArtifactManifest(
  value: unknown,
): PackageReleaseArtifactManifest {
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

function runTar(args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('tar', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function isAllowedTarballEntry(entry: string) {
  const exactEntries = new Set([
    'package/',
    'package/dist/',
    'package/dist-cjs/',
    'package/package.json',
    'package/README.md',
    'package/CHANGELOG.md',
    'package/LICENSE',
    'package/styles.css',
  ])
  return (
    !entry.endsWith('.map') &&
    (exactEntries.has(entry) ||
      entry.startsWith('package/dist/') ||
      entry.startsWith('package/dist-cjs/'))
  )
}

function validatePackedManifest(
  value: unknown,
  artifact: PackageReleaseArtifact,
) {
  const validPublicManifest =
    isJsonObject(value) &&
    value.name === artifact.name &&
    value.version === artifact.version &&
    isJsonObject(value.publishConfig) &&
    value.publishConfig.access === 'public' &&
    isJsonObject(value.repository) &&
    value.repository.url === 'https://github.com/OpenWaggle/OpenWaggle.git' &&
    !JSON.stringify(value).includes('workspace:')
  if (!validPublicManifest) {
    throw new Error(`${artifact.name} packed manifest does not match the public release contract.`)
  }
  if (
    artifact.dependency !== undefined &&
    (!isJsonObject(value.dependencies) ||
      value.dependencies[artifact.dependency.name] !== `^${artifact.dependency.version}`)
  ) {
    throw new Error(`${artifact.name} packed dependency does not match the release artifact.`)
  }
}

async function validateTarballContract(
  artifactRoot: string,
  artifact: PackageReleaseArtifact,
) {
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
  if (
    `sha512-${createHash('sha512').update(contents).digest('base64')}` !== artifact.integrity
  ) {
    throw new Error(`${artifact.name} artifact npm integrity is invalid.`)
  }
  const entries = (await runTar(['-tf', tarballPath])).split('\n').filter(Boolean)
  const unexpectedEntry = entries.find((entry) => !isAllowedTarballEntry(entry))
  if (unexpectedEntry !== undefined) {
    throw new Error(`${artifact.name} artifact contains unexpected entry ${unexpectedEntry}.`)
  }
  const packedManifest: unknown = JSON.parse(
    await runTar(['-xOf', tarballPath, 'package/package.json']),
  )
  validatePackedManifest(packedManifest, artifact)
}

function matchesPlanPackage(
  artifact: PackageReleaseArtifact | undefined,
  plannedPackage: PackageReleasePlanItem,
) {
  return (
    artifact !== undefined &&
    artifact.key === plannedPackage.key &&
    artifact.name === plannedPackage.name &&
    artifact.tag === plannedPackage.tag &&
    artifact.version === plannedPackage.version &&
    artifact.dependency?.name === plannedPackage.dependency
  )
}

export async function verifyReleaseArtifactBundle(
  plan: PackageReleasePlan,
  artifactRoot: string,
) {
  const rawManifest: unknown = JSON.parse(
    await readFile(path.join(artifactRoot, 'release-artifacts.json'), 'utf8'),
  )
  const manifest = decodePackageReleaseArtifactManifest(rawManifest)
  if (
    manifest.sourceTree !== plan.sourceTree ||
    manifest.packages.length !== plan.packages.length ||
    plan.packages.some(
      (plannedPackage, index) =>
        !matchesPlanPackage(manifest.packages[index], plannedPackage),
    )
  ) {
    throw new Error('Package release artifact manifest does not match the source identity and plan.')
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
  await Promise.all(
    manifest.packages.map((artifact) => validateTarballContract(artifactRoot, artifact)),
  )
  return manifest
}
