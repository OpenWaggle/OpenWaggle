import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import {
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
  requiredSessionQueryCapabilities,
} from './domain/session-control/session-capability-authorization'
import type { OpenWaggleMcpServeOptions, OpenWaggleMcpServer } from './openwaggle-mcp-server-policy'
import { buildMcpSessionPayloadV2, sessionInputSchemaV2 } from './openwaggle-mcp-session-input-v2'
import {
  filterMcpSessionQueryResult,
  prepareMcpSessionTargetScope,
} from './openwaggle-mcp-session-scope-v2'
import { assertProjectAllowed } from './openwaggle-mcp-workspace-policy'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { ensureLocalSessionHost } from './session-host/local-session-host-launcher'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'
import { assertFilesystemWriteScope } from './utils/filesystem-write-scope'

export {
  buildMcpSessionPayloadV2,
  type SessionToolInputV2,
  sessionInputSchemaV2,
} from './openwaggle-mcp-session-input-v2'

function requireGrant(options: OpenWaggleMcpServeOptions, grant: SessionCapability) {
  if (!options.grants.has(grant)) {
    throw new Error(
      `The caller profile ${JSON.stringify(options.profile)} lacks ${grant}. Restart with --grant ${grant} after reviewing the requested authority.`,
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

export function assertSuccessfulMcpSessionResult(
  value: Awaited<ReturnType<typeof executeLocalSessionCommand>>,
) {
  if (value.contract === 'session-query-v2' && 'error' in value.response.outcome) {
    throw new Error(`${value.response.outcome.error.code}: ${value.response.outcome.error.message}`)
  }
  if (
    (value.contract === 'session-control-v2' || value.contract === 'session-lifecycle-v2') &&
    value.response.outcome.effect === 'rejected'
  ) {
    throw new Error(
      `${value.response.outcome.code}: ${value.response.outcome.operation} was rejected.`,
    )
  }
  return value
}

function requiredCapabilities(payload: LocalSessionCommandPayload) {
  if (
    payload.contract === 'local-ui-v1' ||
    payload.contract === 'local-attachments-v1' ||
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1'
  ) {
    throw new Error('Local GUI contracts are not available through the Sessions MCP adapter.')
  }
  if (payload.contract === 'local-access-v1') {
    throw new Error('Profile administration is not available through the Sessions MCP adapter.')
  }
  if (payload.contract === 'session-waggle-v1' || payload.contract === 'session-waggle-cancel-v1') {
    throw new Error(
      'Explicit GUI Waggle contracts are not available through the Sessions MCP adapter.',
    )
  }
  return payload.contract === 'session-control-v2'
    ? requiredSessionControlCapabilities(payload.request.command)
    : payload.contract === 'session-lifecycle-v2'
      ? requiredSessionLifecycleCapabilities(payload.request.command)
      : requiredSessionQueryCapabilities(payload.request.query)
}

export async function prepareMcpSessionFilesystemScope(
  options: Pick<OpenWaggleMcpServeOptions, 'workspaceRoots' | 'exportRoots' | 'sessionIds'>,
  input: LocalSessionCommandPayload,
) {
  let payload = input
  if (
    payload.contract === 'session-lifecycle-v2' &&
    (payload.request.command.operation === 'create' ||
      payload.request.command.operation === 'launch')
  ) {
    if (options.workspaceRoots.length === 0) {
      throw new Error('Creating or launching a Session requires an explicit MCP workspace grant.')
    }
    payload = {
      ...payload,
      request: {
        ...payload.request,
        command: {
          ...payload.request.command,
          projectPath: assertProjectAllowed(options, payload.request.command.projectPath),
        },
      },
    }
  }
  if (payload.contract === 'session-query-v2' && 'projectPath' in payload.request.query) {
    const projectPath = payload.request.query.projectPath
    if (projectPath) {
      if (options.workspaceRoots.length === 0) {
        throw new Error('Project filters require an explicit MCP workspace grant.')
      }
      payload = {
        ...payload,
        request: {
          ...payload.request,
          query: {
            ...payload.request.query,
            projectPath: assertProjectAllowed(options, projectPath),
          },
        },
      }
    }
  }
  if (
    payload.contract === 'session-control-v2' &&
    payload.request.command.operation === 'export-create'
  ) {
    const scope = await assertFilesystemWriteScope({
      roots: options.exportRoots ?? [],
      destinationPath: payload.request.command.destinationPath,
    })
    payload = {
      ...payload,
      request: {
        ...payload.request,
        command: {
          ...payload.request.command,
          destinationPath: scope.destinationPath,
          destinationRoot: scope.rootPath,
        },
      },
    }
  }
  return payload
}

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

export function mcpTransientAuthority(
  options: OpenWaggleMcpServeOptions,
  payload: LocalSessionCommandPayload,
): LocalSessionProfileAuthority {
  const projectPath = payloadProjectPath(payload)
  return {
    profileId: `mcp:${options.profile}`,
    profileName: options.profile,
    capabilities: [...options.grants],
    scope: {
      workspaceRoots: options.workspaceRoots,
      ...(options.exportRoots?.length ? { exportRoots: options.exportRoots } : {}),
      ...(options.attachmentRoots?.length ? { attachmentRoots: options.attachmentRoots } : {}),
      ...(projectPath ? { projectPaths: [projectPath] } : {}),
      ...(options.sessionIds.size > 0 ? { sessionIds: [...options.sessionIds] } : {}),
    },
    authorizationCeiling: 'ask-for-approval',
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
    throw new Error(
      `The report source must be the immutable --origin-session ${JSON.stringify(originSessionId)}.`,
    )
  }
}

export function registerOpenWaggleSessionToolV2(
  server: OpenWaggleMcpServer,
  options: OpenWaggleMcpServeOptions,
  client: { readonly userDataRoot: string; readonly version: string },
) {
  const paths = resolveLocalSessionHostPaths({ userDataRoot: client.userDataRoot })
  const execute = async (payload: LocalSessionCommandPayload) => {
    await prepareLocalSessionHostPaths(paths)
    const connection = {
      paths,
      clientKind: 'mcp' as const,
      clientVersion: client.version,
      workingDirectory: options.workspaceRoots[0] ?? process.cwd(),
      transientAuthority: mcpTransientAuthority(options, payload),
    }
    await ensureLocalSessionHost(connection)
    return executeLocalSessionCommand({ ...connection, payload })
  }
  server.registerTool(
    'openwaggle_sessions',
    {
      title: 'OpenWaggle sessions',
      description:
        'Session Control v2 for durable OpenWaggle Sessions and Runs. Supports independent roots, Hive Worker spawning, provenance-labelled peer reports, exact active-Run Steering, durable Follow-ups, bounded waits, paginated reads, and queue inspection through the same Local Session Host used by the GUI and CLI.',
      inputSchema: sessionInputSchemaV2,
    },
    async (input) => {
      let payload: LocalSessionCommandPayload = buildMcpSessionPayloadV2(input)
      assertMcpOriginProvenance(options, payload)
      for (const capability of requiredCapabilities(payload)) requireGrant(options, capability)
      payload = await prepareMcpSessionFilesystemScope(options, payload)
      const scopedPayload = await prepareMcpSessionTargetScope(options, execute, payload)
      const result = assertSuccessfulMcpSessionResult(await execute(scopedPayload))
      return toolResult(await filterMcpSessionQueryResult(options, execute, result))
    },
  )
}
