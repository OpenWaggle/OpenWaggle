import { isAbsolute, join, relative, resolve } from 'node:path'
import type { JsonObject, JsonValue } from '@shared/types/json'

const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
export const PI_CONFIG_DIR = '.pi'
export type ResourceKind = 'skills' | 'extensions' | 'prompts' | 'themes'
type ResourceRootSegments = Readonly<Record<ResourceKind, readonly string[]>>

export interface OpenWaggleExtensionPiResourceRoot {
  readonly packagePath: string
  readonly resourceRoot: string
}

export interface OpenWaggleResourcePrecedenceOptions {
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly enabledOpenWaggleExtensionResourceRoots?: readonly OpenWaggleExtensionPiResourceRoot[]
}

const OPENWAGGLE_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['..', OPENWAGGLE_CONFIG_DIR, 'skills'],
  extensions: ['..', OPENWAGGLE_CONFIG_DIR, 'extensions'],
  prompts: ['..', OPENWAGGLE_CONFIG_DIR, 'prompts'],
  themes: ['..', OPENWAGGLE_CONFIG_DIR, 'themes'],
}
const PI_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['skills'],
  extensions: ['extensions'],
  prompts: ['prompts'],
  themes: ['themes'],
}
const AGENTS_RESOURCE_ROOTS: ResourceRootSegments = {
  skills: ['..', '.agents', 'skills'],
  extensions: ['..', '.agents', 'extensions'],
  prompts: ['..', '.agents', 'prompts'],
  themes: ['..', '.agents', 'themes'],
}

export function isStringArray(value: JsonValue | undefined) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function prependResourceRoots(
  projectPath: string,
  configured: JsonValue | undefined,
  roots: readonly string[],
) {
  const result: string[] = []
  const seen = new Set<string>()

  function addPath(candidate: string) {
    const resolved = resolveResourcePath(projectPath, candidate)
    if (seen.has(resolved)) {
      return
    }
    seen.add(resolved)
    result.push(candidate)
  }

  for (const root of roots) {
    addPath(root)
  }
  if (isStringArray(configured)) {
    for (const configuredPath of configured) {
      addPath(configuredPath)
    }
  }

  return result
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPackageSource(value: JsonValue): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (isJsonObject(value) && typeof value.source === 'string') {
    return value.source
  }
  return null
}

function segmentsToPath(segments: readonly string[]) {
  return join(...segments)
}

export function resolveResourcePath(projectPath: string, candidate: string) {
  return isAbsolute(candidate) ? candidate : join(projectPath, PI_CONFIG_DIR, candidate)
}

function isInsideProject(projectPath: string, packagePath: string) {
  const relativePath = relative(resolve(projectPath), resolve(packagePath))
  return relativePath.length === 0 || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function toPiExtensionPath(projectPath: string, packagePath: string) {
  const normalizedPackagePath = resolve(packagePath)
  return isInsideProject(projectPath, normalizedPackagePath)
    ? relative(join(projectPath, PI_CONFIG_DIR), normalizedPackagePath)
    : normalizedPackagePath
}

function normalizeExtensionResourceRoot(resourceRoot: string) {
  return resourceRoot.replaceAll('\\', '/').split('/')
}

function toPiExtensionResourceKindPath(
  projectPath: string,
  resourceRoot: OpenWaggleExtensionPiResourceRoot,
  kind: ResourceKind,
) {
  const rootSegments = normalizeExtensionResourceRoot(resourceRoot.resourceRoot)
  const resourceKindPath = join(resourceRoot.packagePath, ...rootSegments, kind)
  return toPiExtensionPath(projectPath, resourceKindPath)
}

function resolvePackageSourcePath(projectPath: string, source: string) {
  return isAbsolute(source) ? source : join(projectPath, PI_CONFIG_DIR, source)
}

export function packageSourceIdentity(projectPath: string, source: string) {
  return `local:${resolve(resolvePackageSourcePath(projectPath, source))}`
}

export function packageEntryIdentity(projectPath: string, entry: JsonValue) {
  const source = getPackageSource(entry)
  return source === null ? null : packageSourceIdentity(projectPath, source)
}

export function getImplicitOpenWaggleExtensionPackageSources(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  return (options.enabledOpenWaggleExtensionPackagePaths ?? []).map((packagePath) =>
    toPiExtensionPath(projectPath, packagePath),
  )
}

function prependPackageSources(
  projectPath: string,
  configured: JsonValue | undefined,
  packageSources: readonly string[],
) {
  const result: JsonValue[] = []
  const seen = new Set<string>()

  function addPackage(entry: JsonValue) {
    const identity = packageEntryIdentity(projectPath, entry)
    if (identity !== null) {
      if (seen.has(identity)) {
        return
      }
      seen.add(identity)
    }
    result.push(entry)
  }

  for (const packageSource of packageSources) {
    addPackage(packageSource)
  }
  if (Array.isArray(configured)) {
    for (const configuredPackage of configured) {
      addPackage(configuredPackage)
    }
  }

  return result
}

function getImplicitExtensionPackageResourceRoots(
  projectPath: string,
  kind: ResourceKind,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  return (options.enabledOpenWaggleExtensionResourceRoots ?? []).map((resourceRoot) =>
    toPiExtensionResourceKindPath(projectPath, resourceRoot, kind),
  )
}

export function getImplicitResourceRoots(
  projectPath: string,
  kind: ResourceKind,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  if (kind === 'skills') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.skills),
      ...getImplicitExtensionPackageResourceRoots(projectPath, 'skills', options),
      segmentsToPath(PI_RESOURCE_ROOTS.skills),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.skills),
    ]
  }
  if (kind === 'extensions') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions),
      ...getImplicitExtensionPackageResourceRoots(projectPath, 'extensions', options),
      segmentsToPath(PI_RESOURCE_ROOTS.extensions),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.extensions),
    ]
  }
  if (kind === 'prompts') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.prompts),
      ...getImplicitExtensionPackageResourceRoots(projectPath, 'prompts', options),
      segmentsToPath(PI_RESOURCE_ROOTS.prompts),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.prompts),
    ]
  }
  return [
    segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.themes),
    ...getImplicitExtensionPackageResourceRoots(projectPath, 'themes', options),
    segmentsToPath(PI_RESOURCE_ROOTS.themes),
    segmentsToPath(AGENTS_RESOURCE_ROOTS.themes),
  ]
}

export function getImplicitExtensionResourceRoots(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  const openWaggleExtensionRoots =
    options.enabledOpenWaggleExtensionPackagePaths === undefined
      ? [segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions)]
      : []

  return [
    ...openWaggleExtensionRoots,
    ...getImplicitExtensionPackageResourceRoots(projectPath, 'extensions', options),
    segmentsToPath(PI_RESOURCE_ROOTS.extensions),
    segmentsToPath(AGENTS_RESOURCE_ROOTS.extensions),
  ]
}

export function getOpenWaggleExtensionResourceRoot() {
  return segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions)
}

export function withOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
  options: OpenWaggleResourcePrecedenceOptions = {},
) {
  const packageSources = getImplicitOpenWaggleExtensionPackageSources(projectPath, options)
  return {
    ...settings,
    ...(packageSources.length > 0
      ? {
          packages: prependPackageSources(projectPath, settings.packages, packageSources),
        }
      : {}),
    skills: prependResourceRoots(
      projectPath,
      settings.skills,
      getImplicitResourceRoots(projectPath, 'skills', options),
    ),
    extensions: prependResourceRoots(
      projectPath,
      settings.extensions,
      getImplicitExtensionResourceRoots(projectPath, options),
    ),
    prompts: prependResourceRoots(
      projectPath,
      settings.prompts,
      getImplicitResourceRoots(projectPath, 'prompts', options),
    ),
    themes: prependResourceRoots(
      projectPath,
      settings.themes,
      getImplicitResourceRoots(projectPath, 'themes', options),
    ),
  }
}
