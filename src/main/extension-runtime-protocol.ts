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
const MODULE_CONTEXT_VALUE_SEGMENT_OFFSET = MODULE_FILE_SEGMENT_OFFSET + 1
const MODULE_CONTEXT_FILE_SEGMENT_OFFSET = MODULE_CONTEXT_VALUE_SEGMENT_OFFSET + 1

let extensionRuntimeProtocolRegistered = false

export interface RegisterExtensionRuntimeProtocolDependencies {
  readonly isExtensionRuntimeModuleAllowed?: (
    input: ExtensionRuntimeModuleAccessInput,
  ) => Promise<boolean>
}

interface RuntimeModuleContext {
  readonly fileSegmentOffset: number
  readonly sessionId?: string
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
  const seenProjectPaths = new Set<string>()
  for (const projectPath of parsedContext) {
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      return null
    }
    if (!seenProjectPaths.has(projectPath)) {
      seenProjectPaths.add(projectPath)
      projectPaths.push(projectPath)
    }
  }

  return projectPaths
}

function moduleContextSessionId(parsedContext: unknown) {
  if (typeof parsedContext !== 'object' || parsedContext === null || Array.isArray(parsedContext)) {
    return null
  }

  if (!('sessionId' in parsedContext)) {
    return undefined
  }

  const sessionId = parsedContext.sessionId
  if (typeof sessionId !== 'string') {
    return null
  }

  const trimmedSessionId = sessionId.trim()
  return trimmedSessionId.length > 0 ? trimmedSessionId : null
}

function decodeModuleContext(
  contextSegment: string,
): Omit<RuntimeModuleContext, 'fileSegmentOffset'> | null {
  const decodedContext = decodePathSegment(contextSegment)
  if (decodedContext === null) {
    return null
  }

  let parsedContext: unknown
  try {
    parsedContext = parseJsonUnknown(decodedContext)
  } catch {
    return null
  }

  const sessionId = moduleContextSessionId(parsedContext)
  if (sessionId === null) {
    return null
  }

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
  }
}

function runtimeModuleContext(pathSegments: readonly string[]): RuntimeModuleContext | null {
  if (
    pathSegments[MODULE_FILE_SEGMENT_OFFSET] !==
    OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT
  ) {
    return { fileSegmentOffset: MODULE_FILE_SEGMENT_OFFSET }
  }

  const contextSegment = pathSegments[MODULE_CONTEXT_VALUE_SEGMENT_OFFSET]
  if (!contextSegment) {
    return null
  }

  const context = decodeModuleContext(contextSegment)
  if (context === null) {
    return null
  }

  return {
    fileSegmentOffset: MODULE_CONTEXT_FILE_SEGMENT_OFFSET,
    ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
  }
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
  const moduleContext = runtimeModuleContext(pathSegments)
  if (moduleContext === null) {
    return null
  }

  const fileSegments = pathSegments.slice(moduleContext.fileSegmentOffset)
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
    ...(moduleContext.sessionId !== undefined ? { sessionId: moduleContext.sessionId } : {}),
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

  const { contentHash, packagePath, projectPaths, relativePath, sessionId } = moduleRequest
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
    ...(sessionId !== undefined ? { sessionId } : {}),
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
