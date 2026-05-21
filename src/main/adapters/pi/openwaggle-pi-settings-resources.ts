import { join } from 'node:path'
import type { JsonObject, JsonValue } from '@shared/types/json'

const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
export const PI_CONFIG_DIR = '.pi'
type ResourceKind = 'skills' | 'extensions' | 'prompts' | 'themes'
type ResourceRootSegments = Readonly<Record<ResourceKind, readonly string[]>>

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
  roots: readonly (readonly string[])[],
) {
  const result: string[] = []
  const seen = new Set<string>()

  function addPath(candidate: string) {
    const resolved = join(projectPath, PI_CONFIG_DIR, candidate)
    if (seen.has(resolved)) {
      return
    }
    seen.add(resolved)
    result.push(candidate)
  }

  for (const root of roots) {
    addPath(join(...root))
  }
  if (isStringArray(configured)) {
    for (const configuredPath of configured) {
      addPath(configuredPath)
    }
  }

  return result
}

function getImplicitResourceRoots(kind: ResourceKind) {
  if (kind === 'skills') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.skills,
      PI_RESOURCE_ROOTS.skills,
      AGENTS_RESOURCE_ROOTS.skills,
    ]
  }
  if (kind === 'extensions') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.extensions,
      PI_RESOURCE_ROOTS.extensions,
      AGENTS_RESOURCE_ROOTS.extensions,
    ]
  }
  if (kind === 'prompts') {
    return [
      OPENWAGGLE_RESOURCE_ROOTS.prompts,
      PI_RESOURCE_ROOTS.prompts,
      AGENTS_RESOURCE_ROOTS.prompts,
    ]
  }
  return [OPENWAGGLE_RESOURCE_ROOTS.themes, PI_RESOURCE_ROOTS.themes, AGENTS_RESOURCE_ROOTS.themes]
}
export function withOpenWaggleResourcePrecedence(projectPath: string, settings: JsonObject) {
  return {
    ...settings,
    skills: prependResourceRoots(projectPath, settings.skills, getImplicitResourceRoots('skills')),
    extensions: prependResourceRoots(
      projectPath,
      settings.extensions,
      getImplicitResourceRoots('extensions'),
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
) {
  if (!isStringArray(configured)) {
    return undefined
  }

  const implicitRoots = new Set(
    getImplicitResourceRoots(kind).map((root) => join(projectPath, PI_CONFIG_DIR, join(...root))),
  )
  const filtered = configured.filter(
    (configuredPath) => !implicitRoots.has(join(projectPath, PI_CONFIG_DIR, configuredPath)),
  )
  return filtered.length > 0 ? filtered : undefined
}

export function withoutImplicitOpenWaggleResourcePrecedence(
  projectPath: string,
  settings: JsonObject,
) {
  const next: JsonObject = { ...settings }
  const skills = removeImplicitResourceRoots(projectPath, settings.skills, 'skills')
  const extensions = removeImplicitResourceRoots(projectPath, settings.extensions, 'extensions')
  const prompts = removeImplicitResourceRoots(projectPath, settings.prompts, 'prompts')
  const themes = removeImplicitResourceRoots(projectPath, settings.themes, 'themes')

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
