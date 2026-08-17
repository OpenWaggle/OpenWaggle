import type { McpRuntimeNotice, McpServerSummary, McpSettingsView } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { createMcpManagementRuntimeNamespace } from '../domain/mcp/runtime-namespace'
import { type McpRuntimeConnectionStatus, McpRuntimeService } from '../ports/mcp-runtime-service'

function runtimeNamespaces(view: McpSettingsView) {
  const namespaces = new Set<string>()
  if (view.sessionId) namespaces.add(view.sessionId)
  if (view.projectPath) {
    namespaces.add(
      createMcpManagementRuntimeNamespace({
        projectPath: view.projectPath,
        sessionId: view.sessionId,
      }),
    )
  }
  return namespaces
}

function selectConnectionStatuses(
  view: McpSettingsView,
  statuses: readonly McpRuntimeConnectionStatus[],
) {
  const namespaces = runtimeNamespaces(view)
  const selected = new Map<string, McpRuntimeConnectionStatus>()
  for (const status of statuses) {
    if (status.projectPath !== view.projectPath || !namespaces.has(status.runtimeNamespace))
      continue
    const current = selected.get(status.serverInstanceId)
    const statusIsActiveTurn = status.runtimeNamespace === view.sessionId
    const currentIsActiveTurn = current?.runtimeNamespace === view.sessionId
    if (!current || statusIsActiveTurn || !currentIsActiveTurn) {
      selected.set(status.serverInstanceId, status)
    }
  }
  return selected
}

function mergeNotices(
  configured: readonly McpRuntimeNotice[],
  runtime: readonly McpRuntimeNotice[],
) {
  const notices = new Map<string, McpRuntimeNotice>()
  for (const notice of configured) notices.set(notice.id, notice)
  for (const notice of runtime) notices.set(notice.id, notice)
  return [...notices.values()]
}

function mergeServerState(
  server: McpServerSummary,
  status: McpRuntimeConnectionStatus | undefined,
  notices: readonly McpRuntimeNotice[],
): McpServerSummary {
  const runtimeError = notices.find(
    (notice) => notice.serverInstanceId === server.instanceId && notice.severity !== 'info',
  )
  if (!status && !runtimeError) return server
  const connectionState = status
    ? runtimeError
      ? 'degraded'
      : status.connectionState
    : server.connectionState === 'blocked'
      ? 'blocked'
      : 'degraded'
  return {
    ...server,
    connectionState,
    ...(status?.negotiatedProtocolVersion
      ? { negotiatedProtocolVersion: status.negotiatedProtocolVersion }
      : {}),
    ...(status ? { capabilities: status.capabilities } : {}),
    ...(runtimeError ? { lastError: runtimeError.detail } : {}),
  }
}

export function mergeMcpRuntimeSettingsView(input: {
  readonly view: McpSettingsView
  readonly statuses: readonly McpRuntimeConnectionStatus[]
  readonly runtimeNotices: readonly McpRuntimeNotice[]
}): McpSettingsView {
  const statuses = selectConnectionStatuses(input.view, input.statuses)
  const notices = mergeNotices(input.view.notices, input.runtimeNotices)
  return {
    ...input.view,
    servers: input.view.servers.map((server) =>
      mergeServerState(server, statuses.get(server.instanceId), notices),
    ),
    notices,
  }
}

export function withMcpRuntimeSettings(view: McpSettingsView) {
  return Effect.gen(function* () {
    const runtime = yield* McpRuntimeService
    const statuses = yield* runtime.getConnectionStatuses()
    const runtimeNotices: McpRuntimeNotice[] = []
    for (const runtimeNamespace of runtimeNamespaces(view)) {
      runtimeNotices.push(...(yield* runtime.getNotices(runtimeNamespace)))
    }
    return mergeMcpRuntimeSettingsView({ view, statuses, runtimeNotices })
  })
}

export function reconcileMcpRuntimeSettings(view: McpSettingsView) {
  return Effect.gen(function* () {
    const runtime = yield* McpRuntimeService
    yield* runtime.reconcileIdleConnections()
    return yield* withMcpRuntimeSettings(view)
  })
}
