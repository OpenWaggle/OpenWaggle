import { readFile, realpath, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  currentNativeArtifactRuntime,
  materializeNativeArtifactPath,
  nativeArtifactRequirements,
  type NativeArtifactRuntime,
} from './native-artifact-contract'

const NODE_MODULES_SEGMENT = 'node_modules'
const PACKAGE_JSON_FILE = 'package.json'
const ELECTRON_REBUILD_METADATA_FILE = '.forge-meta'
const EXECUTABLE_MODE_MASK = 0o111

interface NativePackageMetadata {
  readonly name: string
  readonly version?: string
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
  runtime: NativeArtifactRuntime = currentNativeArtifactRuntime(),
) {
  const signatures: NativeArtifactSignature[] = []
  for (const packageName of packageNames) {
    for (const requirement of nativeArtifactRequirements(packageName, runtime)) {
      const artifactPath = await resolveRequiredArtifact(paths, requirement.candidates)
      if (artifactPath === null) {
        const candidates = requirement.candidates
          .map((candidate) => `${candidate.packageName}/${candidate.relativePath}`)
          .join(', ')
        throw new Error(
          `Missing ${packageName} ${requirement.label}; checked exact active paths: ${candidates}.`,
        )
      }
      const artifactStat = await stat(artifactPath)
      if (!artifactStat.isFile()) {
        throw new Error(`${packageName} ${requirement.label} is not a regular file: ${artifactPath}.`)
      }
      if (
        requirement.executable &&
        runtime.platform !== 'win32' &&
        (artifactStat.mode & EXECUTABLE_MODE_MASK) === 0
      ) {
        throw new Error(`${packageName} ${requirement.label} is not executable: ${artifactPath}.`)
      }
      signatures.push({
        packageName,
        path: relative(paths.projectRoot, artifactPath),
        size: artifactStat.size,
        mtimeMs: artifactStat.mtimeMs,
      })
    }
  }

  return sortArtifactSignatures(signatures)
}

export async function removeElectronRebuildMetadata(
  paths: NativeArtifactPaths,
  packageNames: readonly string[],
) {
  for (const packageName of packageNames) {
    for (const packageRoot of await findActivePackageRoots(paths, packageName)) {
      await rm(join(packageRoot, 'build', 'Release', ELECTRON_REBUILD_METADATA_FILE), {
        force: true,
      })
    }
  }
}

export async function removeNativeBuildDirectories(
  paths: NativeArtifactPaths,
  packageNames: readonly string[],
) {
  for (const packageName of packageNames) {
    for (const packageRoot of await findActivePackageRoots(paths, packageName)) {
      await rm(join(packageRoot, 'build'), {
        force: true,
        recursive: true,
      })
    }
  }
}

function sortArtifactSignatures(signatures: readonly NativeArtifactSignature[]) {
  return [...signatures].sort((left, right) =>
    `${left.packageName}:${left.path}`.localeCompare(`${right.packageName}:${right.path}`),
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
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
    version:
      'version' in packageJson && typeof packageJson.version === 'string'
        ? packageJson.version
        : undefined,
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

async function resolveRequiredArtifact(
  paths: NativeArtifactPaths,
  candidates: readonly { readonly packageName: string; readonly relativePath: string }[],
) {
  for (const candidate of candidates) {
    const packageRoots = await findActivePackageRoots(paths, candidate.packageName)
    if (packageRoots.length > 1) {
      throw new Error(
        `Multiple active roots found for ${candidate.packageName}: ${packageRoots.join(', ')}.`,
      )
    }
    const packageRoot = packageRoots[0]
    if (!packageRoot) continue
    const metadata = await readPackageMetadata(packageRoot)
    const relativePath = materializeNativeArtifactPath(candidate.relativePath, metadata?.version)
    const artifactPath = join(packageRoot, relativePath)
    try {
      if ((await stat(artifactPath)).isFile()) return artifactPath
    } catch {
      // Try the next exact runtime candidate.
    }
  }
  return null
}
