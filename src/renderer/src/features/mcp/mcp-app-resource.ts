import type { McpJsonValue, McpResourceResult } from '@shared/types/mcp'
import type { McpAppCsp } from '@shared/types/mcp-app-frame'
import { sanitizedMcpAppCsp } from '@shared/utils/mcp-app-csp'

export type { McpAppCsp } from '@shared/types/mcp-app-frame'

export interface ParsedMcpAppResource {
  /** The App's HTML as the server sent it; the Host serves it with its policy. */
  readonly html: string
  /** The origins the server declares for the App, reduced to plain origins (ADR 0053). */
  readonly csp: McpAppCsp
  readonly requestedPermissions: readonly string[]
}

function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function list(value: McpJsonValue | undefined) {
  return Array.isArray(value) ? value : []
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

/**
 * The App document and the origins its server declares in the resource's `_meta.ui.csp` (or the
 * older `ui/csp`). Adding a server is the trust decision (ADR 0051), so its App may reach what it
 * declares; it runs in a sandboxed, opaque-origin frame with no Electron, Node, storage, or
 * device access, and reaches nothing it did not declare.
 */
export function parseMcpAppResource(result: McpResourceResult): ParsedMcpAppResource {
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
  const permissions = metadata.permissions ?? metadata['ui/permissions']
  return {
    html: content.text,
    csp: sanitizedMcpAppCsp({
      connectDomains: list(cspValue.connectDomains).filter((v) => typeof v === 'string'),
      resourceDomains: list(cspValue.resourceDomains).filter((v) => typeof v === 'string'),
      frameDomains: list(cspValue.frameDomains).filter((v) => typeof v === 'string'),
      baseUriDomains: list(cspValue.baseUriDomains).filter((v) => typeof v === 'string'),
    }),
    requestedPermissions: permissionNames(permissions),
  }
}
