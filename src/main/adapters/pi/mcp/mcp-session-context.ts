import { safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import { isRecord } from '@shared/utils/validation'
import type { McpConnectionHooks } from '../../mcp/pool/mcp-connection-pool-api'
import { recordMcpAppTools } from './mcp-app-registry'
import type { McpRuntimeInteractions } from './mcp-interaction-types'
import { recordMcpServerToolsListing } from './mcp-server-status-registry'
import { repairMcpToolListResult } from './mcp-tool-schema-repair'

/**
 * What a Session's pooled connections need from its current Run: who may answer sampling and
 * elicitation, and each server's grant identity. Set while a Pi session of the Session is alive.
 * Between Runs there is no one to ask, so those requests are refused.
 */
interface SessionMcpContext {
  readonly interactions: McpRuntimeInteractions
  readonly servers: ReadonlyMap<string, { readonly identity: string }>
}

const contexts = new Map<string, SessionMcpContext>()

/** Attaches a Run's interactions; returns the function that detaches exactly them. */
export function attachSessionMcpContext(sessionId: string, context: SessionMcpContext) {
  contexts.set(sessionId, context)
  return () => {
    if (contexts.get(sessionId) === context) contexts.delete(sessionId)
  }
}

const UI_EXTENSION = 'io.modelcontextprotocol/ui'
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** Declares what OpenWaggle answers on Pi's behalf: sampling, elicitation, and MCP Apps. */
export function withOpenWaggleClientCapabilities(params: unknown) {
  if (!isRecord(params)) return params
  const capabilities = isRecord(params.capabilities) ? params.capabilities : {}
  const extensions = isRecord(capabilities.extensions) ? capabilities.extensions : {}
  return {
    ...params,
    capabilities: {
      ...capabilities,
      sampling: {},
      elicitation: { form: {}, url: {} },
      extensions: { ...extensions, [UI_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] } },
    },
  }
}

function jsonRequest(params: unknown): McpJsonValue {
  const decoded = safeDecodeUnknown(mcpConfigValueSchema, params ?? null)
  if (!decoded.success) throw new Error('The MCP server sent a request OpenWaggle cannot read.')
  return decoded.data
}

function requireContext(sessionId: string, serverName: string, identity: string | undefined) {
  const context = contexts.get(sessionId)
  // A server a Pi extension registered is not in the configuration; its lease names its identity.
  const serverIdentity = context?.servers.get(serverName)?.identity ?? identity
  if (!context || !serverIdentity) {
    throw new Error(
      `MCP server "${serverName}" asked for input while the session is idle; OpenWaggle answers only during a Run.`,
    )
  }
  return { interactions: context.interactions, identity: serverIdentity }
}

/** OpenWaggle's additions to one Session's server connection. */
export function openWaggleMcpConnectionHooks(
  sessionId: string,
  serverName: string,
  identity?: string,
): McpConnectionHooks {
  return {
    augmentInitializeParams: withOpenWaggleClientCapabilities,
    // Pi drops a tool's `_meta`, where an MCP App names its `ui://` resource, so it is read here.
    // The same listing is what Settings > MCP shows for the server without connecting to it.
    observeResult: (method, params, result) => {
      if (method !== 'tools/list') return
      recordMcpAppTools(sessionId, serverName, result)
      if (identity) recordMcpServerToolsListing(identity, params, result)
    },
    adaptResult: (method, result) => repairMcpToolListResult(serverName, method, result),
    handleServerRequest: ({ method, params, signal }) => {
      if (method === 'sampling/createMessage') {
        return Promise.resolve().then(() => {
          const { interactions, identity: serverInstanceId } = requireContext(
            sessionId,
            serverName,
            identity,
          )
          return interactions.sample({
            serverInstanceId,
            serverLabel: serverName,
            request: jsonRequest(params),
            signal,
          })
        })
      }
      if (method === 'elicitation/create') {
        return Promise.resolve().then(() => {
          const { interactions, identity: serverInstanceId } = requireContext(
            sessionId,
            serverName,
            identity,
          )
          return interactions.elicit({
            serverInstanceId,
            serverLabel: serverName,
            request: jsonRequest(params),
            signal,
          })
        })
      }
      return undefined
    },
  }
}
