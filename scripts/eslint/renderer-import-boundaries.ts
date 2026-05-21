const RENDERER_SRC_PREFIX = 'src/renderer/src/'
const ALIAS_PREFIX_LENGTH = 2
const FEATURE_ROOT_DEPTH = 2
const FEATURE_PUBLIC_API_DEPTH = 3
const FEATURE_INDEX_API_DEPTH = 4
const FEATURE_SEGMENT_INDEX = 2
const FEATURE_INDEX_SEGMENT_INDEX = 3

const PUBLIC_FEATURE_SEGMENTS = new Set([
  'commands',
  'components',
  'constants',
  'hooks',
  'lib',
  'model',
  'state',
])
const PUBLIC_SHELL_SEGMENTS = new Set(['ui-store', 'useFullscreen'])

type RendererPathInfo =
  | {
      readonly kind: 'feature'
      readonly featureName: string
      readonly isFeaturePublicApi: boolean
    }
  | { readonly kind: 'shared' }
  | { readonly kind: 'routes' }
  | { readonly kind: 'shell'; readonly isShellPublicApi: boolean }
  | { readonly kind: 'legacy'; readonly root: string }
  | { readonly kind: 'other' }

function normalizePath(value: string) {
  return value.replaceAll('\\', '/')
}

function stripExtension(value: string) {
  return value.replace(/\.(ts|tsx|js|jsx)$/, '')
}

function toRendererPath(filename: string) {
  const normalized = normalizePath(filename)
  const index = normalized.lastIndexOf(RENDERER_SRC_PREFIX)
  if (index === -1) {
    return null
  }

  return normalized.slice(index + RENDERER_SRC_PREFIX.length)
}

function resolveRendererImport(importPath: string, importerPath: string) {
  if (importPath.startsWith('@/')) {
    return stripExtension(importPath.slice(ALIAS_PREFIX_LENGTH))
  }

  if (!importPath.startsWith('.')) {
    return null
  }

  const importerParts = importerPath.split('/')
  importerParts.pop()

  for (const part of importPath.split('/')) {
    if (part === '.' || part === '') {
      continue
    }

    if (part === '..') {
      importerParts.pop()
      continue
    }

    importerParts.push(part)
  }

  return stripExtension(importerParts.join('/'))
}

function isFeaturePublicRendererPath(parts: readonly string[]) {
  return (
    parts.length === FEATURE_ROOT_DEPTH ||
    isFeatureSegmentPublicApi(parts) ||
    isFeatureIndexPublicApi(parts)
  )
}

function isFeatureSegmentPublicApi(parts: readonly string[]) {
  const segment = parts[FEATURE_SEGMENT_INDEX] ?? ''
  return (
    parts.length === FEATURE_PUBLIC_API_DEPTH &&
    (segment === 'index' || PUBLIC_FEATURE_SEGMENTS.has(segment))
  )
}

function isFeatureIndexPublicApi(parts: readonly string[]) {
  const segment = parts[FEATURE_SEGMENT_INDEX] ?? ''
  return (
    parts.length === FEATURE_INDEX_API_DEPTH &&
    PUBLIC_FEATURE_SEGMENTS.has(segment) &&
    parts[FEATURE_INDEX_SEGMENT_INDEX] === 'index'
  )
}

function classifyRendererPath(rendererPath: string): RendererPathInfo {
  const parts = rendererPath.split('/')
  const [root, featureName] = parts

  if (root === 'features' && featureName) {
    return {
      kind: 'feature',
      featureName,
      isFeaturePublicApi: isFeaturePublicRendererPath(parts),
    }
  }

  if (root === 'shared') {
    return { kind: 'shared' }
  }

  if (root === 'routes') {
    return { kind: 'routes' }
  }

  if (root === 'shell') {
    return {
      kind: 'shell',
      isShellPublicApi:
        parts.length === 1 || parts[1] === 'index' || PUBLIC_SHELL_SEGMENTS.has(parts[1] ?? ''),
    }
  }

  if (root === 'components' || root === 'hooks' || root === 'stores') {
    return { kind: 'legacy', root }
  }

  return { kind: 'other' }
}

function isFeaturePublicApi(pathInfo: RendererPathInfo) {
  return pathInfo.kind === 'feature' && pathInfo.isFeaturePublicApi
}

function isShellPublicApi(pathInfo: RendererPathInfo) {
  return pathInfo.kind === 'shell' && pathInfo.isShellPublicApi
}

function isAllowedRendererImport(importer: RendererPathInfo, target: RendererPathInfo) {
  if (target.kind === 'other') {
    return true
  }

  if (target.kind === 'legacy') {
    return false
  }

  if (importer.kind === 'shared') {
    return target.kind === 'shared'
  }

  if (importer.kind === 'routes') {
    return (
      target.kind === 'routes' ||
      target.kind === 'shared' ||
      isShellPublicApi(target) ||
      isFeaturePublicApi(target)
    )
  }

  if (importer.kind === 'shell') {
    return target.kind === 'shell' || target.kind === 'shared' || isFeaturePublicApi(target)
  }

  if (importer.kind === 'feature') {
    if (target.kind === 'shared') {
      return true
    }

    if (target.kind === 'feature') {
      return target.featureName === importer.featureName || target.isFeaturePublicApi
    }

    return isShellPublicApi(target)
  }

  return true
}

export function isRendererImportAllowed(importPath: string, importerFilename: string) {
  const importerPath = toRendererPath(importerFilename)
  if (!importerPath) {
    return true
  }

  const resolvedTarget = resolveRendererImport(importPath, importerPath)
  if (!resolvedTarget) {
    return true
  }

  return isAllowedRendererImport(
    classifyRendererPath(importerPath),
    classifyRendererPath(resolvedTarget),
  )
}
