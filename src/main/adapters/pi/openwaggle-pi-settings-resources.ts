import { isAbsolute, join, relative, resolve } from 'node:path'
import type { JsonObject, JsonValue } from '@shared/types/json'

const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
export const PI_CONFIG_DIR = '.pi'
type ResourceKind = 'skills' | 'extensions' | 'prompts' | 'themes'
type ResourceRootSegments = Readonly<Record<ResourceKind, readonly string[]>>

export interface OpenWaggleResourcePrecedenceOptions {
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
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

function resolveResourcePath(projectPath: string, candidate: string) {
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

function resolvePackageSourcePath(projectPath: string, source: string) {
  return isAbsolute(source) ? source : join(projectPath, PI_CONFIG_DIR, source)
}

function packageSourceIdentity(projectPath: string, source: string) {
  return `local:${resolve(resolvePackageSourcePath(projectPath, source))}`
}

function packageEntryIdentity(projectPath: string, entry: JsonValue) {
  const source = getPackageSource(entry)
  return source === null ? null : packageSourceIdentity(projectPath, source)
}

function getImplicitOpenWaggleExtensionPackageSources(
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

function getImplicitResourceRoots(kind: ResourceKind) {
  if (kind === 'skills') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.skills),
      segmentsToPath(PI_RESOURCE_ROOTS.skills),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.skills),
    ]
  }
  if (kind === 'extensions') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions),
      segmentsToPath(PI_RESOURCE_ROOTS.extensions),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.extensions),
    ]
  }
  if (kind === 'prompts') {
    return [
      segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.prompts),
      segmentsToPath(PI_RESOURCE_ROOTS.prompts),
      segmentsToPath(AGENTS_RESOURCE_ROOTS.prompts),
    ]
  }
  return [
    segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.themes),
    segmentsToPath(PI_RESOURCE_ROOTS.themes),
    segmentsToPath(AGENTS_RESOURCE_ROOTS.themes),
  ]
}

function getImplicitExtensionResourceRoots(options: OpenWaggleResourcePrecedenceOptions) {
  const openWaggleExtensionRoots =
    options.enabledOpenWaggleExtensionPackagePaths === undefined
      ? [segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions)]
      : []

  return [
    ...openWaggleExtensionRoots,
    segmentsToPath(PI_RESOURCE_ROOTS.extensions),
    segmentsToPath(AGENTS_RESOURCE_ROOTS.extensions),
  ]
}

function getRemovableImplicitExtensionResourceRoots(options: OpenWaggleResourcePrecedenceOptions) {
  return [
    segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions),
    ...getImplicitExtensionResourceRoots(options),
  ]
}

function getRemovableImplicitOpenWaggleExtensionPackageSources(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  return getImplicitOpenWaggleExtensionPackageSources(projectPath, options).map((source) =>
    packageSourceIdentity(projectPath, source),
  )
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
    skills: prependResourceRoots(projectPath, settings.skills, getImplicitResourceRoots('skills')),
    extensions: prependResourceRoots(
      projectPath,
      settings.extensions,
      getImplicitExtensionResourceRoots(options),
    ),
    prompts: prependResourceRoots(
      projectPath,
      settings.prompts,
      getImplicitResourceRoots('prompts'),
    ),
    themes: prependResourceRoots(projectPath, settings.themes, getImplicitResourceRoots('themes')),
  }
}

function removeImplicitResourceRoots(
  projectPath: string,
  configured: JsonValue | undefined,
  kind: ResourceKind,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  if (!isStringArray(configured)) {
    return undefined
  }

  const implicitRoots = new Set(
    (kind === 'extensions'
      ? getRemovableImplicitExtensionResourceRoots(options)
      : getImplicitResourceRoots(kind)
    ).map((root) => resolveResourcePath(projectPath, root)),
  )
  const filtered = configured.filter(
    (configuredPath) => !implicitRoots.has(resolveResourcePath(projectPath, configuredPath)),
  )
  return filtered.length > 0 ? filtered : undefined
}

function removeImplicitPackageSources(
  projectPath: string,
  configured: JsonValue | undefined,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  const implicitPackageSources = new Set(
    getRemovableImplicitOpenWaggleExtensionPackageSources(projectPath, options),
  )
  if (implicitPackageSources.size === 0) {
    return { shouldUpdate: false } as const
  }

  if (!Array.isArray(configured)) {
    return { shouldUpdate: true, packages: undefined } as const
  }

  const filtered = configured.filter((entry) => {
    const identity = packageEntryIdentity(projectPath, entry)
    return identity === null || !implicitPackageSources.has(identity)
  })
  return {
    shouldUpdate: true,
    packages: filtered.length > 0 ? filtered : undefined,
  } as const
}

export function withoutImplicitOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
  options: OpenWaggleResourcePrecedenceOptions = {},
) {
  const next: JsonObject = { ...settings }
  const packagesResult = removeImplicitPackageSources(projectPath, settings.packages, options)
  const skills = removeImplicitResourceRoots(projectPath, settings.skills, 'skills', options)
  const extensions = removeImplicitResourceRoots(
    projectPath,
    settings.extensions,
    'extensions',
    options,
  )
  const prompts = removeImplicitResourceRoots(projectPath, settings.prompts, 'prompts', options)
  const themes = removeImplicitResourceRoots(projectPath, settings.themes, 'themes', options)

  if (packagesResult.shouldUpdate) {
    if (packagesResult.packages) {
      next.packages = packagesResult.packages
    } else {
      delete next.packages
    }
  }
  if (skills) {
    next.skills = skills
  } else {
    delete next.skills
  }
  if (extensions) {
    next.extensions = extensions
  } else {
    delete next.extensions
  }
  if (prompts) {
    next.prompts = prompts
  } else {
    delete next.prompts
  }
  if (themes) {
    next.themes = themes
  } else {
    delete next.themes
  }

  return next
}
