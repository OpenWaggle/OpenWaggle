import { existsSync } from 'node:fs'
import { extname, join, posix, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { net, protocol } from 'electron'
import { env } from './env'

export const RENDERER_PROTOCOL = 'openwaggle'
export const RENDERER_PROTOCOL_HOST = 'app'
export const RENDERER_PROTOCOL_ORIGIN = `${RENDERER_PROTOCOL}://${RENDERER_PROTOCOL_HOST}`
export const EXTENSION_RUNTIME_PROTOCOL = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME
export const INDEX_HTML = 'index.html'
const HTTP_NOT_FOUND_STATUS = 404

let rendererProtocolRegistered = false

export function registerRendererScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: EXTENSION_RUNTIME_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

function rendererRootPath() {
  return resolve(__dirname, '../renderer')
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
  return is.dev && env.ELECTRON_RENDERER_URL ? env.ELECTRON_RENDERER_URL : null
}

function fileResponse(filePath: string) {
  return net.fetch(pathToFileURL(filePath).toString())
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

  protocol.handle(RENDERER_PROTOCOL, (request) => {
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
