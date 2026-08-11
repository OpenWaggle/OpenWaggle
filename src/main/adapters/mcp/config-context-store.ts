import type {
  McpGetSettingsInput,
  McpRemoveServerInput,
  McpSetScopeStateInput,
  McpSetServerEnabledInput,
  McpSetServerTrustInput,
  McpTurnSnapshot,
  McpWriteSourceConfigInput,
} from '@shared/types/mcp'
import { validateMcpScopeMutation } from '../../domain/mcp/scope-policy'
import { createMcpRevision } from './config-identity'
import type { McpFilesystemConfigServiceOptions, McpUserStateFile } from './config-types'
import {
  blockedReason,
  buildMcpSettingsView,
  type LoadedMcpContext,
  normalizeProjectPath,
  normalizeServerPermissions,
  normalizeSessionId,
  requestedServerPermissions,
  resolveIntegrationState,
  resolveServers,
  serverByInstanceId,
  serverPermissionsMatch,
  updateServerState,
} from './config-view'
import { parseMcpConfigFile, readMcpUserState, writeJsonFileAtomic } from './json-files'
import { withProcessFileLock } from './process-file-lock'
import { getMcpSourceDefinition, getMcpUserStatePath, loadMcpSources } from './source-definitions'

export class McpConfigContextStore {
  private readonly statePath: string
  private stateQueue: Promise<void> = Promise.resolve()

  constructor(readonly options: McpFilesystemConfigServiceOptions) {
    this.statePath = getMcpUserStatePath(options)
  }

  async runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.stateQueue.then(() => withProcessFileLock(this.statePath, operation))
    this.stateQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  persistStateUnlocked(state: McpUserStateFile) {
    return writeJsonFileAtomic(this.statePath, state)
  }

  async loadContextUnlocked(input: McpGetSettingsInput = {}): Promise<LoadedMcpContext> {
    const projectPath = normalizeProjectPath(input.projectPath)
    const [state, sources] = await Promise.all([
      readMcpUserState(this.statePath),
      loadMcpSources(this.options, projectPath),
    ])
    const resolved = resolveServers(state, sources, this.options.createId)
    if (resolved.stateChanged) await this.persistStateUnlocked(resolved.state)
    return { state: resolved.state, sources, servers: resolved.servers }
  }

  loadContext(input: McpGetSettingsInput = {}): Promise<LoadedMcpContext> {
    return this.runSerialized(() => this.loadContextUnlocked(input))
  }

  async getViewUnlocked(input: McpGetSettingsInput = {}) {
    const projectPath = normalizeProjectPath(input.projectPath)
    const sessionId = normalizeSessionId(input.sessionId)
    return buildMcpSettingsView({
      context: await this.loadContextUnlocked({ projectPath, sessionId }),
      projectPath,
      sessionId,
    })
  }

  getView(input: McpGetSettingsInput = {}) {
    return this.runSerialized(() => this.getViewUnlocked(input))
  }

  getServerDefinition(input: McpRemoveServerInput) {
    return this.runSerialized(async () => {
      const server = serverByInstanceId(await this.loadContextUnlocked(input), input.instanceId)
      return { instanceId: server.state.instanceId, definition: server.definition }
    })
  }

  setScopeState(input: McpSetScopeStateInput) {
    return this.runSerialized(async () => {
      const projectPath = normalizeProjectPath(input.projectPath)
      const sessionId = normalizeSessionId(input.sessionId)
      const error = validateMcpScopeMutation({ ...input, projectPath, sessionId })
      if (error) throw new Error(error)
      const context = await this.loadContextUnlocked({ projectPath, sessionId })
      await this.persistStateUnlocked(
        scopeStateMutation(context.state, input, projectPath, sessionId),
      )
      return this.getViewUnlocked({ projectPath, sessionId })
    })
  }

  setServerEnabled(input: McpSetServerEnabledInput) {
    return this.runSerialized(async () => {
      const context = await this.loadContextUnlocked(input)
      const server = serverByInstanceId(context, input.instanceId)
      await this.persistStateUnlocked(
        updateServerState(context.state, server.identityKey, {
          ...server.state,
          enabled: input.enabled,
        }),
      )
      return this.getViewUnlocked(input)
    })
  }

  setServerTrust(input: McpSetServerTrustInput) {
    return this.runSerialized(async () => {
      const context = await this.loadContextUnlocked(input)
      const server = serverByInstanceId(context, input.instanceId)
      if (input.trusted && server.issues.length > 0) {
        throw new Error(`Cannot trust ${server.name}: ${server.issues.join(' ')}`)
      }
      const requestedPermissions = requestedServerPermissions(server.definition)
      if (
        input.trusted &&
        (!input.permissions || !serverPermissionsMatch(input.permissions, requestedPermissions))
      ) {
        throw new Error(
          `Cannot trust ${server.name}: approve the exact filesystem and network permissions requested by the current configuration.`,
        )
      }
      const nextState = input.trusted
        ? {
            ...server.state,
            trustedConfigHash: server.configHash,
            allowUnsandboxed: input.allowUnsandboxed === true,
            permissions: normalizeServerPermissions(input.permissions ?? requestedPermissions),
          }
        : { instanceId: server.state.instanceId, enabled: server.state.enabled }
      await this.persistStateUnlocked(
        updateServerState(context.state, server.identityKey, nextState),
      )
      return this.getViewUnlocked(input)
    })
  }

  writeSourceConfig(input: McpWriteSourceConfigInput) {
    return this.runSerialized(async () => {
      const projectPath = normalizeProjectPath(input.projectPath)
      const definition = getMcpSourceDefinition(this.options, input.sourceId, projectPath)
      await writeJsonFileAtomic(definition.path, parseMcpConfigFile(input.rawJson))
      return this.getViewUnlocked({ projectPath })
    })
  }

  createTurnSnapshot(input: {
    readonly projectPath: string
    readonly executionPath?: string
    readonly sessionId: string
  }): Promise<McpTurnSnapshot | null> {
    return this.runSerialized(() => this.createTurnSnapshotUnlocked(input))
  }

  private async createTurnSnapshotUnlocked(input: {
    readonly projectPath: string
    readonly executionPath?: string
    readonly sessionId: string
  }): Promise<McpTurnSnapshot | null> {
    const projectPath = normalizeProjectPath(input.projectPath)
    const sessionId = normalizeSessionId(input.sessionId)
    if (!projectPath || !sessionId)
      throw new Error('MCP turn snapshots require project and session ids.')
    const executionPath = normalizeProjectPath(input.executionPath) ?? projectPath
    const context = await this.loadContextUnlocked({ projectPath, sessionId })
    const resolution = resolveIntegrationState(context.state, projectPath, sessionId)
    if (resolution.effective === 'off') return null
    const eligible = context.servers.filter(
      (server) =>
        server.state.enabled &&
        server.state.trustedConfigHash === server.configHash &&
        serverPermissionsMatch(
          server.state.permissions,
          requestedServerPermissions(server.definition),
        ) &&
        server.issues.length === 0,
    )
    const eligibleServers = new Set(eligible)
    const requiredBlocked = context.servers.filter(
      (server) => server.definition.required && !eligibleServers.has(server),
    )
    if (requiredBlocked.length > 0) {
      const details = requiredBlocked
        .map(
          (server) => `${server.name}: ${blockedReason(server, resolution.effective) ?? 'blocked'}`,
        )
        .join('; ')
      throw new Error(`Required MCP servers cannot start: ${details}`)
    }
    return {
      id: this.options.createId(),
      sessionId,
      projectPath,
      ...(executionPath === projectPath ? {} : { executionPath }),
      revision: createMcpRevision([
        resolution.effective,
        ...eligible.flatMap((server) => [server.state.instanceId, server.configHash]),
      ]),
      createdAt: Date.now(),
      effectiveState: 'on',
      servers: eligible.map((server) => ({
        instanceId: server.state.instanceId,
        name: server.name,
        sourcePath: server.source.definition.path,
        configHash: server.configHash,
        allowUnsandboxed: server.state.allowUnsandboxed === true,
        permissions: normalizeServerPermissions(
          server.state.permissions ?? requestedServerPermissions(server.definition),
        ),
        definition: server.definition,
      })),
    }
  }
}

function scopeStateMutation(
  state: McpUserStateFile,
  input: McpSetScopeStateInput,
  projectPath: string | null,
  sessionId: string | null,
): McpUserStateFile {
  if (input.scope === 'global') {
    return { ...state, globalState: input.state === 'on' ? 'on' : 'off' }
  }
  if (input.scope === 'project' && projectPath) {
    return { ...state, projectStates: { ...state.projectStates, [projectPath]: input.state } }
  }
  if (sessionId) {
    return { ...state, sessionStates: { ...state.sessionStates, [sessionId]: input.state } }
  }
  return state
}
