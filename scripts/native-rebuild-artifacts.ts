import { access, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const RELEASE_ARTIFACT_DIRECTORY_SEGMENTS = ['build', 'Release']

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
    for (const packageRoot of await findPnpmPackageRoots(paths, packageName)) {
      const releaseDirectory = join(packageRoot, ...RELEASE_ARTIFACT_DIRECTORY_SEGMENTS)
      for (const artifactPath of await collectNodeArtifactPaths(releaseDirectory)) {
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

async function findPnpmPackageRoots(paths: NativeArtifactPaths, packageName: string) {
  const packageRoots: string[] = []
  const packagePathSegments = packageName.split('/')
  for (const entry of await listDirectoryEntries(paths.pnpmPackageDirectory)) {
    if (!entry.isDirectory()) {
      continue
    }

    const packageRoot = join(paths.pnpmPackageDirectory, entry.name, 'node_modules', ...packagePathSegments)
    if (await pathExists(join(packageRoot, 'package.json'))) {
      packageRoots.push(packageRoot)
    }
  }

  return packageRoots.sort()
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

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
