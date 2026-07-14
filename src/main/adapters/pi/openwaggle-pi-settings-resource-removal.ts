import type { JsonObject, JsonValue } from '@shared/types/json'
import {
  getImplicitExtensionResourceRoots,
  getImplicitOpenWaggleExtensionPackageSources,
  getImplicitResourceRoots,
  getOpenWaggleExtensionResourceRoot,
  isStringArray,
  type OpenWaggleResourcePrecedenceOptions,
  packageEntryIdentity,
  packageSourceIdentity,
  type ResourceKind,
  resolveResourcePath,
} from './openwaggle-pi-settings-resources'

function getRemovableImplicitExtensionResourceRoots(
  projectPath: string,
  options: OpenWaggleResourcePrecedenceOptions,
) {
  return [
    getOpenWaggleExtensionResourceRoot(),
    ...getImplicitExtensionResourceRoots(projectPath, options),
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
      : getImplicitResourceRoots(projectPath, kind, options)
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
