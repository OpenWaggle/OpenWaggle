import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const NODE_MODULES_SEGMENT = 'node_modules'
const PACKAGE_JSON_FILE = 'package.json'

interface NativePackageMetadata {
  readonly name: string
  readonly optionalDependencyNames: readonly string[]
}

export type NativeArtifactSignature = {
  readonly packageName: string
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

export type NativeArtifactPaths = {
  readonly projectRoot: string
  readonly pnpmPackageDirectory: string
}

export function isNativeArtifactSignature(value: unknown): value is NativeArtifactSignature {
  return (
    typeof value === 'object' &&
    value !== null &&
    'packageName' in value &&
    typeof value.packageName === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'mtimeMs' in value &&
    typeof value.mtimeMs === 'number'
  )
}

export function artifactSignaturesEqual(
  left: readonly NativeArtifactSignature[],
  right: readonly NativeArtifactSignature[],
) {
  const sortedLeft = sortArtifactSignatures(left)
  const sortedRight = sortArtifactSignatures(right)
  if (sortedLeft.length !== sortedRight.length) {
    return false
  }

  return sortedLeft.every((leftSignature, index) => {
    const rightSignature = sortedRight[index]
    return (
      rightSignature !== undefined &&
      leftSignature.packageName === rightSignature.packageName &&
      leftSignature.path === rightSignature.path &&
      leftSignature.size === rightSignature.size &&
      Object.is(leftSignature.mtimeMs, rightSignature.mtimeMs)
    )
  })
}

export function assertExpectedArtifacts(
  packageNames: readonly string[],
  artifacts: readonly NativeArtifactSignature[],
) {
  const missingPackages = packageNames.filter(
    (packageName) => !artifacts.some((artifact) => artifact.packageName === packageName),
  )
  if (missingPackages.length > 0) {
    throw new Error(
      `Native rebuild completed, but no native artifacts were found for: ${missingPackages.join(', ')}`,
    )
  }
}

export async function collectNativeArtifactSignatures(
  paths: NativeArtifactPaths,
  packageNames: readonly string[],
) {
  const signatures: NativeArtifactSignature[] = []
  for (const packageName of packageNames) {
    for (const packageRoot of await findNativeArtifactRoots(paths, packageName)) {
      for (const artifactPath of await collectNodeArtifactPaths(packageRoot)) {
        const artifactStat = await stat(artifactPath)
        signatures.push({
          packageName,
          path: relative(paths.projectRoot, artifactPath),
          size: artifactStat.size,
          mtimeMs: artifactStat.mtimeMs,
        })
      }
    }
  }

  return sortArtifactSignatures(signatures)
}

function sortArtifactSignatures(signatures: readonly NativeArtifactSignature[]) {
  return [...signatures].sort((left, right) =>
    `${left.packageName}:${left.path}`.localeCompare(`${right.packageName}:${right.path}`),
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function dependencyNames(value: unknown) {
  if (!isObject(value)) {
    return []
  }

  return Object.entries(value).flatMap(([dependencyName, dependencyVersion]) =>
    typeof dependencyVersion === 'string' ? [dependencyName] : [],
  )
}

async function readPackageMetadata(packageRoot: string): Promise<NativePackageMetadata | null> {
  let packageJson: unknown
  try {
    packageJson = JSON.parse(await readFile(join(packageRoot, PACKAGE_JSON_FILE), 'utf8'))
  } catch {
    return null
  }

  if (!isObject(packageJson) || !('name' in packageJson) || typeof packageJson.name !== 'string') {
    return null
  }

  return {
    name: packageJson.name,
    optionalDependencyNames:
      'optionalDependencies' in packageJson
        ? dependencyNames(packageJson.optionalDependencies)
        : [],
  }
}

async function canonicalPath(path: string) {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

function activePackageRootCandidates(paths: NativeArtifactPaths, packageName: string) {
  const packagePathSegments = packageName.split('/')
  return [
    join(paths.projectRoot, NODE_MODULES_SEGMENT, ...packagePathSegments),
    join(paths.pnpmPackageDirectory, NODE_MODULES_SEGMENT, ...packagePathSegments),
  ]
}

async function findActivePackageRoots(paths: NativeArtifactPaths, packageName: string) {
  const packageRoots = new Set<string>()

  for (const candidateRoot of activePackageRootCandidates(paths, packageName)) {
    const metadata = await readPackageMetadata(candidateRoot)
    if (metadata?.name === packageName) {
      packageRoots.add(await canonicalPath(candidateRoot))
    }
  }

  return [...packageRoots].sort()
}

async function findNativeArtifactRoots(paths: NativeArtifactPaths, packageName: string) {
  const packageRoots = new Set(await findActivePackageRoots(paths, packageName))

  for (const packageRoot of [...packageRoots]) {
    const metadata = await readPackageMetadata(packageRoot)
    if (!metadata) {
      continue
    }

    for (const dependencyName of metadata.optionalDependencyNames) {
      for (const dependencyRoot of await findActivePackageRoots(paths, dependencyName)) {
        packageRoots.add(dependencyRoot)
      }
    }
  }

  return [...packageRoots].sort()
}

async function collectNodeArtifactPaths(directory: string) {
  const artifacts: string[] = []
  for (const entry of await listDirectoryEntries(directory)) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      artifacts.push(...(await collectNodeArtifactPaths(entryPath)))
    }
    if (entry.isFile() && entry.name.endsWith('.node')) {
      artifacts.push(entryPath)
    }
  }

  return artifacts.sort()
}

async function listDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
