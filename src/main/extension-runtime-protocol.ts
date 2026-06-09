import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown } from '@shared/schema'
import { app, net, protocol } from 'electron'
import {
  getContentHashRelativePaths,
  getManifestContentHashInput,
  normalizeManifestRelativePath,
} from './adapters/extensions/content-hash-input'
import { loadExtensionManifest } from './adapters/extensions/manifest-loader'
import {
  calculateContentHash,
  resolveSafePackageFilePath,
} from './adapters/extensions/package-files'
import {
  type ExtensionRuntimeModuleAccessInput,
  isExtensionRuntimeModuleAccessAllowed,
} from './application/extension-runtime-module-access-service'
import { runAppEffect } from './runtime'
import { isPathInside } from './utils/paths'

export const EXTENSION_RUNTIME_PROTOCOL = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME

const HTTP_NOT_FOUND_STATUS = 404
const ACCESS_CONTROL_ALLOW_ORIGIN_HEADER = 'access-control-allow-origin'
const CORS_ANY_ORIGIN = '*'
const EXTENSION_PACKAGE_ID_SEGMENT_OFFSET = 2
const MODULE_PREFIX_SEGMENTS =
  OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_PATH_PREFIX.split('/').filter(
    (segment) => segment.length > 0,
  )
const MODULE_PACKAGE_SEGMENT_OFFSET = MODULE_PREFIX_SEGMENTS.length
const MODULE_HASH_SEGMENT_OFFSET = MODULE_PACKAGE_SEGMENT_OFFSET + 1
const MODULE_PROJECT_PATHS_SEGMENT_OFFSET = MODULE_HASH_SEGMENT_OFFSET + 1
const MODULE_FILE_SEGMENT_OFFSET = MODULE_PROJECT_PATHS_SEGMENT_OFFSET + 1

let extensionRuntimeProtocolRegistered = false

export interface RegisterExtensionRuntimeProtocolDependencies {
  readonly isExtensionRuntimeModuleAllowed?: (
    input: ExtensionRuntimeModuleAccessInput,
  ) => Promise<boolean>
}

function hasProjectExtensionRootSegments(packagePath: string) {
  const segments = packagePath.split(/[\\/]+/)
  const [projectConfigSegment, extensionsSegment] = OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS

  return segments.some(
    (segment, index) =>
      segment === projectConfigSegment &&
      segments[index + 1] === extensionsSegment &&
      (segments[index + EXTENSION_PACKAGE_ID_SEGMENT_OFFSET]?.length ?? 0) > 0,
  )
}

function isGlobalExtensionPackagePath(packagePath: string) {
  const globalExtensionsRoot = resolve(
    app.getPath('userData'),
    OPENWAGGLE_EXTENSION.GLOBAL_EXTENSIONS_DIR,
  )

  return packagePath !== globalExtensionsRoot && isPathInside(globalExtensionsRoot, packagePath)
}

function isAllowedExtensionPackagePath(packagePath: string) {
  return hasProjectExtensionRootSegments(packagePath) || isGlobalExtensionPackagePath(packagePath)
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function decodeProjectPaths(projectPathsContext: string) {
  const decodedContext = decodePathSegment(projectPathsContext)
  if (decodedContext === null) {
    return null
  }

  let parsedContext: unknown
  try {
    parsedContext = parseJsonUnknown(decodedContext)
  } catch {
    return null
  }

  if (!Array.isArray(parsedContext)) {
    return null
  }

  const projectPaths: string[] = []
  for (const projectPath of parsedContext) {
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      return null
    }
    if (!projectPaths.includes(projectPath)) {
      projectPaths.push(projectPath)
    }
  }

  return projectPaths
}

function hasRuntimeModulePathPrefix(segments: readonly string[]) {
  return MODULE_PREFIX_SEGMENTS.every((segment, index) => segments[index] === segment)
}

function parseExtensionModuleRequest(requestUrl: string) {
  const url = new URL(requestUrl)
  const protocolConfig = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL

  if (url.host !== protocolConfig.HOST) {
    return null
  }

  const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0)
  if (!hasRuntimeModulePathPrefix(pathSegments)) {
    return null
  }

  const packagePath = pathSegments[MODULE_PACKAGE_SEGMENT_OFFSET]
  const contentHash = pathSegments[MODULE_HASH_SEGMENT_OFFSET]
  const projectPathsContext = pathSegments[MODULE_PROJECT_PATHS_SEGMENT_OFFSET]
  const fileSegments = pathSegments.slice(MODULE_FILE_SEGMENT_OFFSET)
  if (!packagePath || !contentHash || !projectPathsContext || fileSegments.length === 0) {
    return null
  }

  const projectPaths = decodeProjectPaths(projectPathsContext)
  if (projectPaths === null) {
    return null
  }

  const decodedPackagePath = decodePathSegment(packagePath)
  const decodedContentHash = decodePathSegment(contentHash)
  const decodedFileSegments = fileSegments.map(decodePathSegment)
  if (
    !decodedPackagePath ||
    !decodedContentHash ||
    decodedFileSegments.some((segment) => segment === null)
  ) {
    return null
  }

  return {
    packagePath: decodedPackagePath,
    contentHash: decodedContentHash,
    relativePath: decodedFileSegments.join(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR),
    projectPaths,
  }
}

function defaultExtensionRuntimeModuleAccessChecker(input: ExtensionRuntimeModuleAccessInput) {
  return runAppEffect(isExtensionRuntimeModuleAccessAllowed(input))
}

async function resolveExtensionModuleFilePath(
  requestUrl: string,
  isRuntimeModuleAllowed: (input: ExtensionRuntimeModuleAccessInput) => Promise<boolean>,
) {
  const moduleRequest = parseExtensionModuleRequest(requestUrl)
  if (!moduleRequest) {
    return null
  }

  const { contentHash, packagePath, projectPaths, relativePath } = moduleRequest
  const resolvedPackagePath = resolve(packagePath)
  if (!isAllowedExtensionPackagePath(resolvedPackagePath)) {
    return null
  }

  const manifestPath = join(resolvedPackagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE)
  const manifestResult = await loadExtensionManifest(manifestPath)
  if (
    !manifestResult.manifest ||
    !manifestResult.rawManifest ||
    manifestResult.manifest.id !== basename(resolvedPackagePath)
  ) {
    return null
  }

  const hashInput = getManifestContentHashInput(manifestResult.manifest)
  const normalizedRelativePath = normalizeManifestRelativePath(relativePath)
  if (!getContentHashRelativePaths(hashInput).includes(normalizedRelativePath)) {
    return null
  }

  const contentHashResult = await calculateContentHash(
    resolvedPackagePath,
    manifestResult.rawManifest,
    hashInput,
  )
  if (contentHashResult.contentHash !== contentHash) {
    return null
  }

  const runtimeModuleAllowed = await isRuntimeModuleAllowed({
    packagePath: resolvedPackagePath,
    contentHash,
    projectPaths,
  })
  if (!runtimeModuleAllowed) {
    return null
  }

  return resolveSafePackageFilePath(resolvedPackagePath, normalizedRelativePath)
}

async function fileResponse(filePath: string) {
  const response = await net.fetch(pathToFileURL(filePath).toString())
  const headers = new Headers(response.headers)

  headers.set(ACCESS_CONTROL_ALLOW_ORIGIN_HEADER, CORS_ANY_ORIGIN)

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function notFoundResponse() {
  return new Response(null, { status: HTTP_NOT_FOUND_STATUS })
}

export function registerExtensionRuntimeProtocolOnce(
  dependencies: RegisterExtensionRuntimeProtocolDependencies = {},
) {
  if (extensionRuntimeProtocolRegistered) {
    return
  }

  extensionRuntimeProtocolRegistered = true
  const isRuntimeModuleAllowed =
    dependencies.isExtensionRuntimeModuleAllowed ?? defaultExtensionRuntimeModuleAccessChecker

  protocol.handle(EXTENSION_RUNTIME_PROTOCOL, async (request) => {
    try {
      const modulePath = await resolveExtensionModuleFilePath(request.url, isRuntimeModuleAllowed)
      if (!modulePath) {
        return notFoundResponse()
      }

      return fileResponse(modulePath)
    } catch {
      return notFoundResponse()
    }
  })
}
