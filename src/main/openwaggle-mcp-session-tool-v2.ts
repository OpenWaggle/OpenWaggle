import { HIVE_MCP_TOOL_NAME } from '@shared/constants/hive'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import {
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
  requiredSessionQueryCapabilities,
} from './domain/session-control/session-capability-authorization'
import {
  isMcpAgentDefinitionOperation,
  queryMcpAgentDefinitions,
} from './openwaggle-mcp-agent-definitions-v2'
import {
  assertSuccessfulMcpSessionResult,
  mcpLocalRefusal,
  mcpThrownRefusal,
} from './openwaggle-mcp-refusal-message'
import type { OpenWaggleMcpServeOptions, OpenWaggleMcpServer } from './openwaggle-mcp-server-policy'
import { prepareMcpSessionFilesystemScope } from './openwaggle-mcp-session-filesystem-scope-v2'
import {
  buildMcpSessionPayloadV2,
  sessionInputSchemaForGrantsV2,
} from './openwaggle-mcp-session-input-v2'
import {
  filterMcpSessionQueryResult,
  prepareMcpSessionTargetScope,
  SCHEDULED_TASKS_UNAVAILABLE,
} from './openwaggle-mcp-session-scope-v2'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { ensureLocalSessionHost } from './session-host/local-session-host-launcher'
import {
  prepareLocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'

export {
  buildMcpSessionPayloadV2,
  type SessionToolInputV2,
  sessionInputSchemaForGrantsV2,
} from './openwaggle-mcp-session-input-v2'

function requireGrant(
  options: OpenWaggleMcpServeOptions,
  operation: string,
  grant: SessionCapability,
) {
  if (!options.grants.has(grant)) {
    throw mcpLocalRefusal(
      'capability_denied',
      `This MCP server was started without --grant ${grant}, which ${operation} needs. Restart it with --grant ${grant} after reviewing the authority you grant.`,
    )
  }
}

function toolResult(value: unknown) {
  const structuredContent =
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : { value }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent,
  }
}

function requiredCapabilities(payload: LocalSessionCommandPayload) {
  if (
    payload.contract === 'local-ui-v1' ||
    payload.contract === 'local-attachments-v1' ||
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1' ||
    payload.contract === 'host-ui-v1' ||
    payload.contract === 'local-update-v1' ||
    payload.contract === 'local-host-v1' ||
    payload.contract === 'desktop-service-v1'
  ) {
    throw new Error('Local GUI contracts are not available through the Hive MCP adapter.')
  }
  if (payload.contract === 'local-access-v1') {
    throw new Error('Profile administration is not available through the Hive MCP adapter.')
  }
  if (payload.contract === 'session-waggle-v1' || payload.contract === 'session-waggle-cancel-v1') {
    throw new Error('Explicit GUI Waggle contracts are not available through the Hive MCP adapter.')
  }
  if (payload.contract === 'scheduled-tasks-v1') throw new Error(SCHEDULED_TASKS_UNAVAILABLE)
  return payload.contract === 'session-control-v2'
    ? requiredSessionControlCapabilities(payload.request.command)
    : payload.contract === 'session-lifecycle-v2'
      ? requiredSessionLifecycleCapabilities(payload.request.command)
      : requiredSessionQueryCapabilities(payload.request.query)
}

export { assertSuccessfulMcpSessionResult, prepareMcpSessionFilesystemScope }

function payloadProjectPath(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'session-lifecycle-v2') {
    const command = payload.request.command
    return command.operation === 'create' || command.operation === 'launch'
      ? command.projectPath
      : undefined
  }
  if (payload.contract !== 'session-query-v2') return
  const query = payload.request.query
  return 'projectPath' in query ? query.projectPath : undefined
}

/**
 * The server's own grants and scope. With `--owner` they are the whole authority, taken from the
 * local desktop user; with `--profile` they narrow the access profile, and the Session Host keeps
 * only what both allow. A profile keeps its own authorization ceiling: the server sends `yolo`,
 * which the Host lowers to the profile's.
 */
export function mcpTransientAuthority(
  options: OpenWaggleMcpServeOptions,
  payload?: LocalSessionCommandPayload,
): LocalSessionProfileAuthority {
  const projectPath = payload ? payloadProjectPath(payload) : undefined
  const identity = options.identity
  const name = identity.kind === 'owner' ? identity.label : identity.profile
  return {
    profileId: identity.kind === 'owner' ? `mcp:${name}` : `mcp-profile:${name}`,
    profileName: name,
    capabilities: [...options.grants],
    scope: {
      workspaceRoots: options.workspaceRoots,
      ...(options.exportRoots?.length ? { exportRoots: options.exportRoots } : {}),
      ...(options.attachmentRoots?.length ? { attachmentRoots: options.attachmentRoots } : {}),
      ...(projectPath ? { projectPaths: [projectPath] } : {}),
      ...(options.sessionIds.size > 0 ? { sessionIds: [...options.sessionIds] } : {}),
    },
    authorizationCeiling: identity.kind === 'owner' ? identity.authorizationCeiling : 'yolo',
  }
}

/** How the server authenticates to the Session Host for one call. */
export function mcpSessionHostIdentity(
  options: OpenWaggleMcpServeOptions,
  payload?: LocalSessionCommandPayload,
) {
  const transientAuthority = mcpTransientAuthority(options, payload)
  return options.identity.kind === 'owner'
    ? { clientKind: 'mcp' as const, transientAuthority }
    : {
        clientKind: 'mcp' as const,
        profile: options.identity.profile,
        profileCredential: options.identity.credential,
        transientAuthority,
      }
}

export { filterMcpSessionQueryResult } from './openwaggle-mcp-session-scope-v2'

export function assertMcpOriginProvenance(
  options: Pick<OpenWaggleMcpServeOptions, 'originSessionId'>,
  payload: LocalSessionCommandPayload,
) {
  const originSessionId = options.originSessionId
  if (!originSessionId || payload.contract !== 'session-control-v2') return
  const command = payload.request.command
  if (command.operation === 'report' && command.sessionId !== originSessionId) {
    throw mcpLocalRefusal(
      'target_scope_denied',
      `The report source must be the immutable --origin-session ${JSON.stringify(originSessionId)}.`,
    )
  }
}

export type McpSessionHostExecutor = (
  payload: LocalSessionCommandPayload,
) => ReturnType<typeof executeLocalSessionCommand>

export function createMcpSessionHostExecutor(
  options: OpenWaggleMcpServeOptions,
  client: { readonly userDataRoot: string; readonly version: string },
): McpSessionHostExecutor {
  let paths: ReturnType<typeof prepareLocalSessionHostPaths> | undefined
  return async (payload) => {
    paths ??= prepareLocalSessionHostPaths(
      resolveLocalSessionHostPaths({ userDataRoot: client.userDataRoot }),
    )
    const preparedPaths = await paths
    const connection = {
      paths: preparedPaths,
      clientVersion: client.version,
      workingDirectory: options.workspaceRoots[0] ?? process.cwd(),
      ...mcpSessionHostIdentity(options, payload),
    }
    await ensureLocalSessionHost(connection)
    return executeLocalSessionCommand({
      ...connection,
      paths: await refreshLocalSessionHostEndpoint(preparedPaths),
      payload,
    })
  }
}

export function registerOpenWaggleSessionToolV2(
  server: OpenWaggleMcpServer,
  options: OpenWaggleMcpServeOptions,
  client: {
    readonly userDataRoot: string
    readonly version: string
    /** Replaces the Session Host connection; used by conformance tests. */
    readonly execute?: McpSessionHostExecutor
  },
) {
  const execute = client.execute ?? createMcpSessionHostExecutor(options, client)
  const grants = [...options.grants].sort()
  server.registerTool(
    HIVE_MCP_TOOL_NAME,
    {
      title: 'OpenWaggle Hive',
      description: `Session Control v2 for durable OpenWaggle Sessions and Runs. Each operation is the openwaggle hive CLI subcommand of the same name. Only the operations this server's grants allow are listed (${grants.length > 0 ? grants.join(', ') : 'no Session grants'}). Discovery defaults to all Sessions within the caller's granted workspaces and Session ids; projectPath narrows it. Supports independent roots, Hive Worker spawning, provenance-labelled peer reports, exact active-Run Steering, durable Follow-ups, bounded waits, paginated reads, and queue inspection through the same Local Session Host used by the GUI and CLI.`,
      inputSchema: sessionInputSchemaForGrantsV2(options.grants),
    },
    async (input) => {
      if (isMcpAgentDefinitionOperation(input.operation)) {
        return toolResult(
          await queryMcpAgentDefinitions(options, { ...input, operation: input.operation }),
        )
      }
      let payload: LocalSessionCommandPayload = buildMcpSessionPayloadV2(input)
      assertMcpOriginProvenance(options, payload)
      for (const capability of requiredCapabilities(payload)) {
        requireGrant(options, input.operation, capability)
      }
      payload = await prepareMcpSessionFilesystemScope(options, payload)
      // Every Host call, the scope checks' reads included, reports a thrown refusal's kind.
      const hostExecute: McpSessionHostExecutor = (hostPayload) =>
        execute(hostPayload).catch((error: unknown) => {
          throw mcpThrownRefusal(error)
        })
      const scopedPayload = await prepareMcpSessionTargetScope(options, hostExecute, payload)
      const result = assertSuccessfulMcpSessionResult(await hostExecute(scopedPayload))
      return toolResult(await filterMcpSessionQueryResult(options, hostExecute, result))
    },
  )
}
