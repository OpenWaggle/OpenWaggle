import { existsSync } from 'node:fs'
import { extname, join, posix, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUTOMATION_IDENTITY_QUERY_PARAM } from '@shared/constants/desktop-automation'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { networkFetch } from './desktop-shell/network-fetch'
import { trustedOrigins } from './desktop-shell/trusted-origins'
import { env } from './env'
import { TRUSTED_ORIGIN_SCHEMES } from './trusted-origin-schemes'

export { isTrustedRendererRequest } from './renderer-request-trust'

export const RENDERER_PROTOCOL = TRUSTED_ORIGIN_SCHEMES.renderer
export const RENDERER_PROTOCOL_HOST = 'app'
export const RENDERER_PROTOCOL_ORIGIN = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}`
export const EXTENSION_RUNTIME_PROTOCOL = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME
export const INDEX_HTML = 'index.html'
const HTTP_NOT_FOUND_STATUS = 404
const ACCESS_CONTROL_ALLOW_ORIGIN_HEADER = 'access-control-allow-origin'
const CORS_ANY_ORIGIN = '*'

let rendererProtocolRegistered = false

export function configureInlineVisualizationProcessIsolation() {
  appLifecycle.commandLine.appendSwitch('site-per-process')
}

/** Every trusted origin the app serves, declared before ready (A-F11 for `codeCache`). */
export function registerRendererScheme() {
  // `codeCache` lets V8 keep compiled code for the app and extension modules between launches,
  // as for http(s) pages; without it the renderer recompiled its 4.5 MB modulepreload graph on
  // every start (A-F11). V8 checks each entry against the source, so an update recompiles once.
  // Visualization and MCP App frames are not cached: each document has a fresh host. Each App
  // document has its own `frame-<id>` host; the frame is same-origin with that host only, never
  // with OpenWaggle, and nothing under it is fetched by CORS (ADR 0053).
  trustedOrigins.declare([
    { domain: 'renderer', corsEnabled: true, codeCache: true },
    { domain: 'extension-runtime', corsEnabled: true, codeCache: true },
    { domain: 'extension-frame', corsEnabled: true, codeCache: true },
    { domain: 'inline-visualization', corsEnabled: false, codeCache: false },
    { domain: 'mcp-app-frame', corsEnabled: false, codeCache: false },
    { domain: 'session-resource', corsEnabled: false, codeCache: false },
  ])
}

function rendererRootPath() {
  return resolve(import.meta.dirname, '../renderer')
}

function normalizedRendererRequestPath(requestUrl: string) {
  const url = new URL(requestUrl)
  return posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
}

function isRendererStaticAssetRequest(requestUrl: string) {
  try {
    return extname(normalizedRendererRequestPath(requestUrl)).length > 0
  } catch {
    return false
  }
}

function isRendererIndexRequest(requestUrl: string) {
  try {
    const normalizedPath = normalizedRendererRequestPath(requestUrl)
    return normalizedPath.length === 0 || normalizedPath === INDEX_HTML
  } catch {
    return false
  }
}
function resolveRendererFilePath(rendererRoot: string, requestUrl: string) {
  const indexPath = join(rendererRoot, INDEX_HTML)
  const url = new URL(requestUrl)

  if (url.host !== RENDERER_PROTOCOL_HOST) {
    return indexPath
  }

  const normalizedPath = normalizedRendererRequestPath(requestUrl)
  if (normalizedPath.includes('..')) {
    return indexPath
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : INDEX_HTML
  const candidatePath = resolve(rendererRoot, requestedPath)
  const rendererRootPrefix = `${rendererRoot}${sep}`
  const isInsideRendererRoot =
    candidatePath === rendererRoot || candidatePath.startsWith(rendererRootPrefix)

  if (isInsideRendererRoot && existsSync(candidatePath)) {
    return candidatePath
  }

  return indexPath
}

export function devRendererUrl() {
  return !appLifecycle.isPackaged() && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : null
}

export function rendererUrlWithAutomationIdentity(url: string) {
  if (!env.OPENWAGGLE_AUTOMATION_LEASE_TOKEN) return url
  const rendererUrl = new URL(url)
  rendererUrl.searchParams.set(
    AUTOMATION_IDENTITY_QUERY_PARAM,
    env.OPENWAGGLE_AUTOMATION_LEASE_TOKEN,
  )
  return rendererUrl.toString()
}

async function fileResponse(filePath: string) {
  const response = await networkFetch.fetch(pathToFileURL(filePath).toString())
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

export function registerRendererProtocolOnce() {
  if (rendererProtocolRegistered || devRendererUrl() !== null) {
    return
  }

  rendererProtocolRegistered = true
  const rendererRoot = rendererRootPath()
  const indexPath = join(rendererRoot, INDEX_HTML)

  trustedOrigins.serve('renderer', (request) => {
    try {
      const candidatePath = resolveRendererFilePath(rendererRoot, request.url)
      const isAssetRequest = isRendererStaticAssetRequest(request.url)
      if (isAssetRequest && candidatePath === indexPath && !isRendererIndexRequest(request.url)) {
        return notFoundResponse()
      }
      return fileResponse(candidatePath)
    } catch {
      return fileResponse(indexPath)
    }
  })
}
