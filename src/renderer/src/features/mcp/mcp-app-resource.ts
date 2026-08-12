import type { McpJsonValue, McpResourceResult } from '@shared/types/mcp'

interface McpAppCsp {
  readonly connectDomains: string[]
  readonly resourceDomains: string[]
}

export interface ParsedMcpAppResource {
  readonly html: string
  readonly csp: McpAppCsp
  readonly requestedPermissions: readonly string[]
}

function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: McpJsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function uiMetadata(content: Record<string, McpJsonValue>) {
  if (!isObject(content._meta)) return {}
  if (isObject(content._meta.ui)) return content._meta.ui
  return content._meta
}

function permissionNames(value: McpJsonValue | undefined) {
  if (!isObject(value)) return []
  return Object.keys(value).filter((key) => isObject(value[key]))
}

function origin(value: string) {
  try {
    const url = new URL(value.replace('*.', 'wildcard.'))
    if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) return null
    return value.replace(/\/$/, '')
  } catch {
    return null
  }
}

function allowedDeclaredDomains(declared: readonly string[], granted: readonly string[]) {
  const grants = new Set(granted.map(origin).filter((value): value is string => value !== null))
  return declared
    .map(origin)
    .filter((value): value is string => value !== null && grants.has(value))
}

function injectCsp(html: string, csp: McpAppCsp) {
  const resourceDomains = csp.resourceDomains.join(' ')
  const connectDomains = csp.connectDomains.join(' ')
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resourceDomains}`.trim(),
    `style-src 'unsafe-inline' ${resourceDomains}`.trim(),
    `img-src data: blob: ${resourceDomains}`.trim(),
    `font-src ${resourceDomains || "'none'"}`,
    `media-src blob: ${resourceDomains}`.trim(),
    `connect-src ${connectDomains || "'none'"}`,
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const document_ = new DOMParser().parseFromString(html, 'text/html')
  const meta = document_.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = policy
  document_.head.prepend(meta)
  return `<!doctype html>${document_.documentElement.outerHTML}`
}

export function parseMcpAppResource(
  result: McpResourceResult,
  allowedNetworkDomains: readonly string[],
): ParsedMcpAppResource {
  if (!Array.isArray(result.contents)) throw new Error('MCP App resource has no content list.')
  const content = result.contents.find((entry) => isObject(entry) && typeof entry.text === 'string')
  if (!isObject(content) || typeof content.text !== 'string') {
    throw new Error('MCP App resource must contain an HTML text document.')
  }
  const metadata = uiMetadata(content)
  const cspValue = isObject(metadata.csp)
    ? metadata.csp
    : isObject(metadata['ui/csp'])
      ? metadata['ui/csp']
      : {}
  const declaredConnect = strings(cspValue.connectDomains)
  const declaredResources = strings(cspValue.resourceDomains)
  const csp = {
    connectDomains: allowedDeclaredDomains(declaredConnect, allowedNetworkDomains),
    resourceDomains: allowedDeclaredDomains(declaredResources, allowedNetworkDomains),
  }
  const permissions = metadata.permissions ?? metadata['ui/permissions']
  return {
    html: injectCsp(content.text, csp),
    csp,
    requestedPermissions: permissionNames(permissions),
  }
}
