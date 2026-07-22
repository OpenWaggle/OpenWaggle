import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  artifactSignaturesEqual,
  assertExpectedArtifacts,
  collectNativeArtifactSignatures,
  isNativeArtifactSignature,
  type NativeArtifactSignature,
  type NativeArtifactPaths,
} from './native-rebuild-artifacts'

const JSON_INDENT_SPACES = 2
const CACHE_KEY_HASH_LENGTH = 32
const FORCE_REBUILD_FLAG = '--force'
const FORCE_REBUILD_ENV = 'OPENWAGGLE_NATIVE_REBUILD_FORCE'
const FORCE_REBUILD_ENV_VALUES = new Set(['1', 'true', 'yes'])
const NATIVE_REBUILD_CACHE_VERSION = 'electron-builder-native-rebuild-v2'
const NATIVE_STATE_HASH_FILES = ['package.json', 'pnpm-lock.yaml']
const SQLITE_PATCH_PREFIX = 'better-sqlite3@'
const NODE_NATIVE_ARTIFACT_PACKAGES = ['better-sqlite3']
const ELECTRON_NATIVE_ARTIFACT_PACKAGES = ['sharp', 'node-pty', 'better-sqlite3']

export type RebuildMode = 'node' | 'electron'

export type NativeRebuildCacheKeyInput = {
  readonly mode: RebuildMode
  readonly platform: string
  readonly arch: string
  readonly runtimeVersion: string
  readonly nativeStateHash: string
  readonly cacheVersion: string
}

export type NativeRebuildPlan = NativeRebuildCacheKeyInput & {
  readonly key: string
  readonly artifactPackages: readonly string[]
}

type NativeRebuildMarker = NativeRebuildCacheKeyInput & {
  readonly key: string
  readonly artifacts: readonly NativeArtifactSignature[]
}

export type NativeRebuildCachePaths = NativeArtifactPaths & {
  readonly electronPackageJsonPath: string
  readonly cacheDirectory: string
  readonly patchesDirectory: string
}

export function isRebuildMode(value: unknown): value is RebuildMode {
  return value === 'node' || value === 'electron'
}

function hasNativeRebuildMarkerScalars(
  value: object,
): value is Omit<NativeRebuildMarker, 'artifacts'> & { readonly artifacts?: unknown } {
  return (
    'cacheVersion' in value &&
    typeof value.cacheVersion === 'string' &&
    'key' in value &&
    typeof value.key === 'string' &&
    'mode' in value &&
    isRebuildMode(value.mode) &&
    'runtimeVersion' in value &&
    typeof value.runtimeVersion === 'string' &&
    'nativeStateHash' in value &&
    typeof value.nativeStateHash === 'string' &&
    'platform' in value &&
    typeof value.platform === 'string' &&
    'arch' in value &&
    typeof value.arch === 'string'
  )
}

export function parseNativeRebuildMarker(value: unknown): NativeRebuildMarker | null {
  if (!(
    typeof value === 'object' &&
    value !== null &&
    hasNativeRebuildMarkerScalars(value) &&
    'artifacts' in value &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isNativeArtifactSignature)
  )) {
    return null
  }

  return {
    cacheVersion: value.cacheVersion,
    key: value.key,
    mode: value.mode,
    runtimeVersion: value.runtimeVersion,
    nativeStateHash: value.nativeStateHash,
    platform: value.platform,
    arch: value.arch,
    artifacts: value.artifacts,
  }
}

export function createNativeRebuildCacheKey(input: NativeRebuildCacheKeyInput) {
  const hash = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, CACHE_KEY_HASH_LENGTH)

  return `${input.mode}-${hash}`
}

export function nativeArtifactPackagesForMode(mode: RebuildMode) {
  return mode === 'node' ? NODE_NATIVE_ARTIFACT_PACKAGES : ELECTRON_NATIVE_ARTIFACT_PACKAGES
}

export function isNativeRebuildForceEnabled(
  flags: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  const environmentValue = environment[FORCE_REBUILD_ENV]
  return (
    flags.includes(FORCE_REBUILD_FLAG) ||
    (environmentValue !== undefined &&
      FORCE_REBUILD_ENV_VALUES.has(environmentValue.trim().toLowerCase()))
  )
}

export function isNativeRebuildMarkerFresh(
  marker: NativeRebuildMarker,
  plan: NativeRebuildPlan,
  currentArtifacts: readonly NativeArtifactSignature[],
) {
  return (
    marker.cacheVersion === plan.cacheVersion &&
    marker.key === plan.key &&
    marker.mode === plan.mode &&
    marker.runtimeVersion === plan.runtimeVersion &&
    marker.nativeStateHash === plan.nativeStateHash &&
    marker.platform === plan.platform &&
    marker.arch === plan.arch &&
    artifactSignaturesEqual(marker.artifacts, currentArtifacts)
  )
}

export async function createNativeRebuildPlan(paths: NativeRebuildCachePaths, mode: RebuildMode) {
  const runtimeVersion = mode === 'node' ? process.versions.node : await getElectronVersion(paths)
  const input = {
    mode,
    platform: process.platform,
    arch: process.arch,
    runtimeVersion,
    nativeStateHash: await createNativeStateHash(paths),
    cacheVersion: NATIVE_REBUILD_CACHE_VERSION,
  }

  return {
    ...input,
    key: createNativeRebuildCacheKey(input),
    artifactPackages: nativeArtifactPackagesForMode(mode),
  }
}

export async function canUseNativeRebuildCache(
  paths: NativeRebuildCachePaths,
  plan: NativeRebuildPlan,
) {
  const marker = await readNativeRebuildMarker(markerPathForKey(paths, plan.key))
  return (
    marker !== null &&
    isNativeRebuildMarkerFresh(
      marker,
      plan,
      await collectNativeArtifactSignatures(paths, plan.artifactPackages),
    )
  )
}

export async function writeNativeRebuildMarker(
  paths: NativeRebuildCachePaths,
  plan: NativeRebuildPlan,
) {
  const artifacts = await collectNativeArtifactSignatures(paths, plan.artifactPackages)
  assertExpectedArtifacts(plan.artifactPackages, artifacts)

  const marker: NativeRebuildMarker = {
    cacheVersion: plan.cacheVersion,
    key: plan.key,
    mode: plan.mode,
    runtimeVersion: plan.runtimeVersion,
    nativeStateHash: plan.nativeStateHash,
    platform: plan.platform,
    arch: plan.arch,
    artifacts,
  }

  await resetNativeRebuildCacheDirectory(paths)
  await writeFile(markerPathForKey(paths, plan.key), `${JSON.stringify(marker, null, JSON_INDENT_SPACES)}\n`)
}

async function getElectronVersion(paths: NativeRebuildCachePaths) {
  const packageJsonText = await readFile(paths.electronPackageJsonPath, 'utf8')
  const packageJson: unknown = JSON.parse(packageJsonText)
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('version' in packageJson) ||
    typeof packageJson.version !== 'string' ||
    packageJson.version.length === 0
  ) {
    throw new Error('Unable to determine installed Electron version for native dependency rebuild.')
  }
  return packageJson.version
}

async function createNativeStateHash(paths: NativeRebuildCachePaths) {
  const hash = createHash('sha256')
  for (const relativePath of NATIVE_STATE_HASH_FILES) {
    await hashProjectFile(paths, hash, relativePath)
  }
  for (const patchFile of await listSqlitePatchFiles(paths)) {
    await hashProjectFile(paths, hash, join('patches', patchFile))
  }
  return hash.digest('hex')
}

async function hashProjectFile(
  paths: NativeRebuildCachePaths,
  hash: ReturnType<typeof createHash>,
  relativePath: string,
) {
  hash.update(`file:${relativePath}\n`)
  try {
    hash.update(await readFile(join(paths.projectRoot, relativePath)))
  } catch {
    hash.update('missing')
  }
  hash.update('\n')
}

async function listSqlitePatchFiles(paths: NativeRebuildCachePaths) {
  return (await listDirectoryEntries(paths.patchesDirectory))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(SQLITE_PATCH_PREFIX))
    .sort()
}

async function readNativeRebuildMarker(markerPath: string) {
  try {
    const parsed: unknown = JSON.parse(await readFile(markerPath, 'utf8'))
    return parseNativeRebuildMarker(parsed)
  } catch {
    return null
  }
}

async function resetNativeRebuildCacheDirectory(paths: NativeRebuildCachePaths) {
  await rm(paths.cacheDirectory, { recursive: true, force: true })
  await mkdir(paths.cacheDirectory, { recursive: true })
}

function markerPathForKey(paths: NativeRebuildCachePaths, key: string) {
  return join(paths.cacheDirectory, `${key}.json`)
}

async function listDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
