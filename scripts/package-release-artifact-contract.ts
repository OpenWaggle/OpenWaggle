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

/*
 * This module runs under plain Node with no install (package-release-promote.ts loads it), so it
 * checks its JSON with local type guards instead of the shared schemas.
 */
function isJsonObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ReleaseAssetsView {
  readonly tagName: unknown
  readonly assets: readonly unknown[]
}

function isReleaseAssetsView(value: unknown): value is ReleaseAssetsView {
  return (
    isJsonObject(value) && 'tagName' in value && 'assets' in value && Array.isArray(value.assets)
  )
}

function releaseAssetName(value: unknown) {
  return isJsonObject(value) && 'name' in value && typeof value.name === 'string'
    ? value.name
    : undefined
}

export function releaseAssetRepairPlan(
  value: unknown,
  tag: string,
  expectedNames: readonly string[],
) {
  if (!isReleaseAssetsView(value) || value.tagName !== tag) {
    throw new Error(`GitHub Release ${tag} does not match its immutable tag and assets.`)
  }
  const assetNames = value.assets.map((asset) => {
    const name = releaseAssetName(asset)
    if (name === undefined) {
      throw new Error(`GitHub Release ${tag} returned an invalid asset.`)
    }
    return name
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
  const name = isJsonObject(value) && 'name' in value ? value.name : undefined
  const version = isJsonObject(value) && 'version' in value ? value.version : undefined
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error('Package release artifact manifest contains an invalid dependency.')
  }
  return { name, version }
}

interface ArtifactRecord extends Omit<PackageReleaseArtifact, 'dependency'> {
  readonly dependency?: unknown
}

/** Whether every one of `fields` is an own string property of `value`. */
function hasStringFields<TField extends string>(
  value: object,
  fields: readonly TField[],
): value is Readonly<Record<TField, string>> {
  return fields.every(
    (field) => typeof Object.getOwnPropertyDescriptor(value, field)?.value === 'string',
  )
}

const ARTIFACT_STRING_FIELDS = [
  'file',
  'integrity',
  'key',
  'name',
  'releaseNotes',
  'sha256',
  'tag',
  'version',
] as const

function isArtifactRecord(value: unknown): value is ArtifactRecord {
  return isJsonObject(value) && hasStringFields(value, ARTIFACT_STRING_FIELDS)
}

function decodeArtifact(value: unknown) {
  if (!isArtifactRecord(value)) {
    throw new Error('Package release artifact manifest contains an invalid package.')
  }
  const dependency = value.dependency === undefined ? undefined : decodeDependency(value.dependency)
  const artifact: PackageReleaseArtifact = {
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
  return artifact
}

interface ArtifactManifestRecord {
  readonly schemaVersion: 1
  readonly sourceSha: string
  readonly sourceTree: string
  readonly packages: readonly unknown[]
}

function isArtifactManifestRecord(value: unknown): value is ArtifactManifestRecord {
  return (
    isJsonObject(value) &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'sourceSha' in value &&
    typeof value.sourceSha === 'string' &&
    'sourceTree' in value &&
    typeof value.sourceTree === 'string' &&
    'packages' in value &&
    Array.isArray(value.packages)
  )
}

export function decodePackageReleaseArtifactManifest(value: unknown) {
  if (!isArtifactManifestRecord(value)) {
    throw new Error('Package release artifact manifest is invalid.')
  }
  const manifest: PackageReleaseArtifactManifest = {
    packages: value.packages.map(decodeArtifact),
    schemaVersion: 1,
    sourceSha: value.sourceSha,
    sourceTree: value.sourceTree,
  }
  return manifest
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

/** `value[outer][inner]` when both are objects and it is a string. */
function nestedString(value: object, outer: string, inner: string) {
  const nested: unknown = Object.getOwnPropertyDescriptor(value, outer)?.value
  return isJsonObject(nested) && hasStringFields(nested, [inner]) ? nested[inner] : undefined
}

/** The range a packed manifest's `dependencies` map gives `name`, read by its runtime key. */
function packedDependencyRange(manifest: object, name: string) {
  if (!('dependencies' in manifest) || !isJsonObject(manifest.dependencies)) return undefined
  return new Map<string, unknown>(Object.entries(manifest.dependencies)).get(name)
}

function validatePackedManifest(value: unknown, artifact: PackageReleaseArtifact) {
  const validPublicManifest =
    isJsonObject(value) &&
    hasStringFields(value, ['name', 'version']) &&
    value.name === artifact.name &&
    value.version === artifact.version &&
    nestedString(value, 'publishConfig', 'access') === 'public' &&
    nestedString(value, 'repository', 'url') === 'https://github.com/OpenWaggle/OpenWaggle.git' &&
    !JSON.stringify(value).includes('workspace:')
  if (!validPublicManifest) {
    throw new Error(`${artifact.name} packed manifest does not match the public release contract.`)
  }
  if (
    artifact.dependency !== undefined &&
    packedDependencyRange(value, artifact.dependency.name) !== `^${artifact.dependency.version}`
  ) {
    throw new Error(`${artifact.name} packed dependency does not match the release artifact.`)
  }
}

/**
 * Checks that the artifact's tarball is a regular `.tgz` file at the bundle root whose bytes match
 * the recorded SHA-256 and npm integrity, and returns its path.
 */
export async function verifyReleaseArtifactFile(
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
  if (`sha512-${createHash('sha512').update(contents).digest('base64')}` !== artifact.integrity) {
    throw new Error(`${artifact.name} artifact npm integrity is invalid.`)
  }
  return tarballPath
}

async function validateTarballContract(artifactRoot: string, artifact: PackageReleaseArtifact) {
  const tarballPath = await verifyReleaseArtifactFile(artifactRoot, artifact)
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

export async function verifyReleaseArtifactBundle(plan: PackageReleasePlan, artifactRoot: string) {
  const rawManifest: unknown = JSON.parse(
    await readFile(path.join(artifactRoot, 'release-artifacts.json'), 'utf8'),
  )
  const manifest = decodePackageReleaseArtifactManifest(rawManifest)
  if (
    manifest.sourceTree !== plan.sourceTree ||
    manifest.packages.length !== plan.packages.length ||
    plan.packages.some(
      (plannedPackage, index) => !matchesPlanPackage(manifest.packages[index], plannedPackage),
    )
  ) {
    throw new Error(
      'Package release artifact manifest does not match the source identity and plan.',
    )
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
