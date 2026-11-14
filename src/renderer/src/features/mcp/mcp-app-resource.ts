import type { McpJsonValue, McpResourceResult } from '@shared/types/mcp'
import type { McpAppCsp } from '@shared/types/mcp-app-frame'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { isObjectValue } from '@shared/utils/object-shape'
import { sanitizedMcpAppCsp } from '@shared/utils/mcp-app-csp'

export type { McpAppCsp } from '@shared/types/mcp-app-frame'

export interface ParsedMcpAppResource {
  /** The App's HTML as the server sent it; the Host serves it with its policy. */
  readonly html: string
  /** The origins the server declares for the App, reduced to plain origins (ADR 0053). */
  readonly csp: McpAppCsp
  readonly requestedPermissions: readonly string[]
}

/** The `_meta.ui` an MCP App resource declares, under its current or its older key names. */
interface McpAppUiMetadata {
  readonly ui: McpJsonValue
  readonly csp: McpJsonValue
  readonly 'ui/csp': McpJsonValue
  readonly permissions: McpJsonValue
  readonly 'ui/permissions': McpJsonValue
}

interface McpAppCspDeclaration {
  readonly connectDomains: McpJsonValue
  readonly resourceDomains: McpJsonValue
  readonly frameDomains: McpJsonValue
  readonly baseUriDomains: McpJsonValue
}

interface McpAppResourceContent {
  readonly text: McpJsonValue
  readonly _meta: McpJsonValue
}

/** The fields of `T` an object holds, unchecked; nothing for a value that is not an object. */
function fieldsOf<T>(value: unknown) {
  const fields: UncheckedFields<T> = isObjectValue(value) ? value : {}
  return fields
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

function uiMetadata(content: UncheckedFields<McpAppResourceContent>) {
  if (!isObjectValue(content._meta)) return {}
  const meta: UncheckedFields<McpAppUiMetadata> = content._meta
  return isObjectValue(meta.ui) ? fieldsOf<McpAppUiMetadata>(meta.ui) : meta
}

function permissionNames(value: unknown) {
  if (!isObjectValue(value)) return []
  return Object.entries(value).flatMap(([name, permission]) =>
    isObjectValue(permission) ? [name] : [],
  )
}

/**
 * The App document and the origins its server declares in the resource's `_meta.ui.csp` (or the
 * older `ui/csp`). Adding a server is the trust decision (ADR 0051), so its App may reach what it
 * declares; it runs in a sandboxed, opaque-origin frame with no Electron, Node, storage, or
 * device access, and reaches nothing it did not declare.
 */
export function parseMcpAppResource(result: McpResourceResult) {
  if (!Array.isArray(result.contents)) throw new Error('MCP App resource has no content list.')
  const content = result.contents.find(
    (entry) => typeof fieldsOf<McpAppResourceContent>(entry).text === 'string',
  )
  const fields = fieldsOf<McpAppResourceContent>(content)
  if (typeof fields.text !== 'string') {
    throw new Error('MCP App resource must contain an HTML text document.')
  }
  const metadata = uiMetadata(fields)
  const csp = fieldsOf<McpAppCspDeclaration>(
    isObjectValue(metadata.csp) ? metadata.csp : metadata['ui/csp'],
  )
  const resource: ParsedMcpAppResource = {
    html: fields.text,
    csp: sanitizedMcpAppCsp({
      connectDomains: strings(csp.connectDomains),
      resourceDomains: strings(csp.resourceDomains),
      frameDomains: strings(csp.frameDomains),
      baseUriDomains: strings(csp.baseUriDomains),
    }),
    requestedPermissions: permissionNames(metadata.permissions ?? metadata['ui/permissions']),
  }
  return resource
}
