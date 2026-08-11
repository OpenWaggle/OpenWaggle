import path from 'node:path'
import type {
  McpRuntimeNotice,
  McpServerDefinition,
  McpServerPermissionGrant,
  McpServerSummary,
  McpSettingsView,
} from '@shared/types/mcp'
import { resolveMcpScopeState } from '../../domain/mcp/scope-policy'
import {
  resolveMcpCompatibilityProfile,
  resolveMcpDirectToolsMode,
  resolveMcpServerTransport,
  validateMcpServerDefinition,
} from '../../domain/mcp/server-policy'
import type { ActiveMcpTurn } from '../../domain/mcp/turn-application-state'
import { resolveMcpIntegrationState } from '../../domain/mcp/turn-application-state'
import {
  createMcpRevision,
  createMcpServerIdentityKey,
  hashMcpServerDefinition,
} from './config-identity'
import type {
  LoadedMcpSource,
  McpServerUserState,
  McpUserStateFile,
  ResolvedMcpServer,
} from './config-types'

export interface LoadedMcpContext {
  readonly state: McpUserStateFile
  readonly sources: readonly LoadedMcpSource[]
  readonly servers: readonly ResolvedMcpServer[]
}

export function normalizeProjectPath(projectPath?: string | null) {
  const trimmed = projectPath?.trim()
  return trimmed ? path.resolve(trimmed) : null
}

export function normalizeSessionId(sessionId?: string | null) {
  const trimmed = sessionId?.trim()
  return trimmed || null
}

export function resolveIntegrationState(
  state: McpUserStateFile,
  projectPath: string | null,
  sessionId: string | null,
) {
  return resolveMcpScopeState({
    global: state.globalState,
    ...(projectPath ? { project: state.projectStates[projectPath] ?? 'inherit' } : {}),
    ...(sessionId ? { session: state.sessionStates[sessionId] ?? 'inherit' } : {}),
  })
}

function selectEffectiveSourceServers(sources: readonly LoadedMcpSource[]) {
  const selected = new Map<
    string,
    { readonly source: LoadedMcpSource; readonly definition: ResolvedMcpServer['definition'] }
  >()
  for (const source of sources) {
    for (const [name, definition] of Object.entries(source.servers)) {
      selected.set(name, { source, definition })
    }
  }
  return selected
}

export function resolveServers(
  state: McpUserStateFile,
  sources: readonly LoadedMcpSource[],
  createId: () => string,
) {
  const selected = selectEffectiveSourceServers(sources)
  const nextServerState = { ...state.servers }
  const servers: ResolvedMcpServer[] = []
  let stateChanged = false
  for (const [name, selectedServer] of selected) {
    const identityKey = createMcpServerIdentityKey(selectedServer.source.definition.path, name)
    const existingState = state.servers[identityKey]
    const serverState = existingState ?? { instanceId: createId(), enabled: false }
    if (!existingState) {
      nextServerState[identityKey] = serverState
      stateChanged = true
    }
    servers.push({
      identityKey,
      name,
      definition: selectedServer.definition,
      source: selectedServer.source,
      configHash: hashMcpServerDefinition(selectedServer.definition),
      state: serverState,
      issues: validateMcpServerDefinition({
        definition: selectedServer.definition,
        sourceScope: selectedServer.source.definition.scope,
      }),
    })
  }
  return {
    servers,
    stateChanged,
    state: stateChanged ? { ...state, servers: nextServerState } : state,
  }
}

function normalizedRoots(roots: readonly string[]) {
  return [
    ...new Set(
      roots.flatMap((root) => {
        const normalized = root.trim()
        return normalized ? [normalized] : []
      }),
    ),
  ].sort()
}

export function requestedServerPermissions(
  definition: McpServerDefinition,
): McpServerPermissionGrant {
  const readRoots = [definition.cwd ?? '.', ...(definition.security?.readRoots ?? [])]
  return {
    readRoots: normalizedRoots(readRoots),
    writeRoots: normalizedRoots(definition.security?.writeRoots ?? []),
    allowNetwork: definition.security?.allowNetwork === true,
  }
}

export function normalizeServerPermissions(
  permissions: McpServerPermissionGrant,
): McpServerPermissionGrant {
  return {
    readRoots: normalizedRoots(permissions.readRoots),
    writeRoots: normalizedRoots(permissions.writeRoots),
    allowNetwork: permissions.allowNetwork === true,
  }
}

export function serverPermissionsMatch(
  left: McpServerPermissionGrant | undefined,
  right: McpServerPermissionGrant,
) {
  if (!left) return false
  return JSON.stringify(normalizeServerPermissions(left)) === JSON.stringify(right)
}

function trustState(server: ResolvedMcpServer): McpServerSummary['trusted'] {
  const requestedPermissions = requestedServerPermissions(server.definition)
  if (
    server.state.trustedConfigHash === server.configHash &&
    serverPermissionsMatch(server.state.permissions, requestedPermissions)
  )
    return 'trusted'
  return server.state.trustedConfigHash ? 'invalidated' : 'untrusted'
}

export function blockedReason(
  server: ResolvedMcpServer,
  effectiveState: 'on' | 'off',
): string | undefined {
  if (server.issues.length > 0) return server.issues.join(' ')
  const trust = trustState(server)
  if (trust === 'invalidated')
    return 'Trust was invalidated because the server configuration changed.'
  if (!server.state.enabled) return 'Server is disabled.'
  if (trust === 'untrusted') return 'Server has not been trusted.'
  if (effectiveState === 'off') return 'MCP is off for this scope.'
  return undefined
}

function buildServerSummary(
  server: ResolvedMcpServer,
  effectiveState: 'on' | 'off',
): McpServerSummary {
  const blocked = blockedReason(server, effectiveState)
  const requestedPermissions = requestedServerPermissions(server.definition)
  return {
    instanceId: server.state.instanceId,
    name: server.name,
    enabled: server.state.enabled,
    trusted: trustState(server),
    required: server.definition.required === true,
    sourceId: server.source.definition.id,
    sourceLabel: server.source.definition.label,
    sourcePath: server.source.definition.path,
    configHash: server.configHash,
    ...(server.definition.command ? { command: server.definition.command } : {}),
    ...(server.definition.url ? { url: server.definition.url } : {}),
    transport: resolveMcpServerTransport(server.definition),
    compatibility: resolveMcpCompatibilityProfile(server.definition),
    directTools: resolveMcpDirectToolsMode(server.definition),
    auth: server.definition.auth?.type === 'oauth' ? 'oauth' : 'none',
    requestedPermissions,
    ...(server.state.permissions
      ? { grantedPermissions: normalizeServerPermissions(server.state.permissions) }
      : {}),
    connectionState: blocked ? 'blocked' : 'disconnected',
    capabilities: [],
    ...(blocked ? { blockedReason: blocked } : {}),
  }
}

function buildNotices(context: LoadedMcpContext, effectiveState: 'on' | 'off') {
  const notices: McpRuntimeNotice[] = []
  for (const source of context.sources) {
    if (source.parseError) {
      notices.push({
        id: `source:${source.definition.id}:parse`,
        severity: 'error',
        title: `${source.definition.label} is invalid`,
        detail: source.parseError,
        action: 'Fix the JSON before enabling MCP for this scope.',
      })
    }
    if (source.ignoredFields.length > 0) {
      notices.push({
        id: `source:${source.definition.id}:ignored`,
        severity: 'warning',
        title: `${source.definition.label} contains ignored fields`,
        detail: source.ignoredFields.join(', '),
        action: 'Review the fields; OpenWaggle preserves them but does not apply them.',
      })
    }
  }
  for (const server of context.servers) {
    const blocked = blockedReason(server, effectiveState)
    if (!blocked || (!server.state.enabled && !server.definition.required)) continue
    notices.push({
      id: `server:${server.state.instanceId}:blocked`,
      severity: server.definition.required ? 'error' : 'warning',
      title: `${server.name} cannot start`,
      detail: blocked,
      action: 'Review enablement, trust, configuration, credentials, and sandbox grants.',
      serverInstanceId: server.state.instanceId,
    })
  }
  return notices
}

export function buildMcpSettingsView(input: {
  readonly context: LoadedMcpContext
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly activeTurn?: ActiveMcpTurn | undefined
}): McpSettingsView {
  const resolution = resolveIntegrationState(
    input.context.state,
    input.projectPath,
    input.sessionId,
  )
  const eligible = input.context.servers.filter(
    (server) =>
      server.state.enabled && trustState(server) === 'trusted' && server.issues.length === 0,
  )
  const desiredRevision =
    resolution.effective === 'off'
      ? null
      : createMcpRevision([
          resolution.effective,
          ...eligible.flatMap((server) => [server.state.instanceId, server.configHash]),
        ])
  return {
    integration: resolveMcpIntegrationState(input.activeTurn, {
      desired: resolution,
      desiredRevision,
    }),
    sources: input.context.sources.map((source) => ({
      id: source.definition.id,
      label: source.definition.label,
      path: source.definition.path,
      scope: source.definition.scope,
      kind: source.definition.kind,
      exists: source.exists,
      editable: source.definition.editable,
      serverCount: Object.keys(source.servers).length,
      rawJson: source.rawJson,
      ignoredFields: source.ignoredFields,
      ...(source.parseError ? { parseError: source.parseError } : {}),
    })),
    servers: input.context.servers
      .map((server) => buildServerSummary(server, resolution.effective))
      .sort((left, right) => left.name.localeCompare(right.name)),
    notices: buildNotices(input.context, resolution.effective),
    projectPath: input.projectPath,
    sessionId: input.sessionId,
  }
}

export function updateServerState(
  state: McpUserStateFile,
  identityKey: string,
  nextServerState: McpServerUserState,
) {
  return { ...state, servers: { ...state.servers, [identityKey]: nextServerState } }
}

export function withoutServerState(state: McpUserStateFile, identityKey: string) {
  const servers = { ...state.servers }
  delete servers[identityKey]
  return { ...state, servers }
}

export function serverByInstanceId(context: LoadedMcpContext, instanceId: string) {
  const server = context.servers.find((candidate) => candidate.state.instanceId === instanceId)
  if (!server) throw new Error(`MCP server instance "${instanceId}" was not found.`)
  return server
}
