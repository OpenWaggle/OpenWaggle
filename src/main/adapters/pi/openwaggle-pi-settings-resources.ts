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

function getImplicitExtensionResourceRoots(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  const openWaggleExtensionRoots =
    options.enabledOpenWaggleExtensionPackagePaths === undefined
      ? [segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions)]
      : options.enabledOpenWaggleExtensionPackagePaths.map((packagePath) =>
          toPiExtensionPath(projectPath, packagePath),
        )

  return [
    ...openWaggleExtensionRoots,
    segmentsToPath(PI_RESOURCE_ROOTS.extensions),
    segmentsToPath(AGENTS_RESOURCE_ROOTS.extensions),
  ]
}

function getRemovableImplicitExtensionResourceRoots(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  return [
    segmentsToPath(OPENWAGGLE_RESOURCE_ROOTS.extensions),
    ...getImplicitExtensionResourceRoots(projectPath, options),
  ]
}

export function withOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
  options: OpenWaggleResourcePrecedenceOptions = {},
) {
  return {
    ...settings,
    skills: prependResourceRoots(projectPath, settings.skills, getImplicitResourceRoots('skills')),
    extensions: prependResourceRoots(
      projectPath,
      settings.extensions,
      getImplicitExtensionResourceRoots(projectPath, options),
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
      ? getRemovableImplicitExtensionResourceRoots(projectPath, options)
      : getImplicitResourceRoots(kind)
    ).map((root) => resolveResourcePath(projectPath, root)),
  )
  const filtered = configured.filter(
    (configuredPath) => !implicitRoots.has(resolveResourcePath(projectPath, configuredPath)),
  )
  return filtered.length > 0 ? filtered : undefined
}

export function withoutImplicitOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
  options: OpenWaggleResourcePrecedenceOptions = {},
) {
  const next: JsonObject = { ...settings }
  const skills = removeImplicitResourceRoots(projectPath, settings.skills, 'skills', options)
  const extensions = removeImplicitResourceRoots(
    projectPath,
    settings.extensions,
    'extensions',
    options,
  )
  const prompts = removeImplicitResourceRoots(projectPath, settings.prompts, 'prompts', options)
  const themes = removeImplicitResourceRoots(projectPath, settings.themes, 'themes', options)

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
