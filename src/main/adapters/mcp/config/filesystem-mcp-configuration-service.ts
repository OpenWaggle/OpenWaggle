import type {
  McpConfigFileView,
  McpConfigurationView,
  McpConfiguredServerView,
  McpWriteDestination,
} from '@shared/types/mcp-configuration'
import { Effect } from 'effect'
import {
  isOpenWaggleMcpConfigFile,
  type McpConfigFileId,
  type McpMergedServer,
  mcpConfigFileScope,
} from '../../../domain/mcp/config/mcp-config-merge'
import { isJsonRecord } from '../../../domain/mcp/config/mcp-server-config'
import { validateMcpServerEntry } from '../../../domain/mcp/config/mcp-server-entry-validation'
import {
  type McpAddServerInput,
  McpConfigurationError,
  type McpConfigurationScopeInput,
  type McpConfigurationServiceShape,
  type McpRemoveServerInput,
  type McpSetServerEnabledInput,
  type McpSetServerExposureInput,
} from '../../../ports/mcp-configuration-service'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  nodeMcpConfigFileReader,
  readMcpConfigLayers,
} from './mcp-config-files'
import {
  assertDestinationInScope,
  assertNameFree,
  assertNoProjectAuth,
  assertPiReadableDestination,
  assertProjectDestination,
} from './mcp-config-write-guards'
import {
  addMcpServerEntry,
  removeMcpServerEntry,
  updateMcpServerSettings,
} from './mcp-config-writer'
import { loadMcpMergedConfig } from './mcp-runtime-config'

export interface FilesystemMcpConfigurationOptions {
  readonly homeDir: string
  readonly piAgentDir: string
  readonly reader?: McpConfigFileReader
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hasAuthorizationHeader(headers: Readonly<Record<string, unknown>> | undefined) {
  return Object.keys(headers ?? {}).some((header) => header.toLowerCase() === 'authorization')
}

function serverView(server: McpMergedServer): McpConfiguredServerView {
  const { config } = server
  const isUrl = 'url' in config
  return {
    name: server.name,
    transport: server.transport,
    target: isUrl ? config.url : [config.command, ...(config.args ?? [])].join(' '),
    ...(config.description ? { description: config.description } : {}),
    source: server.source,
    scope: server.scope,
    ...(server.override ? { override: server.override } : {}),
    enabled: config.enabled !== false,
    exposure: config.exposure ?? 'codemode',
    toolExposure: config.toolExposure ?? {},
    usesOAuth: isUrl && !config.auth && !hasAuthorizationHeader(config.headers),
  }
}

interface ServiceContext {
  readonly roots: (input: McpConfigurationScopeInput) => McpConfigFileRoots
  readonly reader: McpConfigFileReader
}

function fileFor(
  context: ServiceContext,
  input: McpConfigurationScopeInput,
  fileId: McpConfigFileId,
) {
  const file = mcpConfigFileLocations(context.roots(input)).find(
    (location) => location.fileId === fileId,
  )
  if (!file) {
    throw new McpConfigurationError({
      reason: 'validation',
      message: context.roots(input).projectPath
        ? 'This project is your home folder, so its .openwaggle/mcp.json is the global file. Change the server for every project instead.'
        : 'A project is required for a project MCP file.',
    })
  }
  return file.path
}

function findServer(context: ServiceContext, input: McpConfigurationScopeInput, name: string) {
  const server = loadMcpMergedConfig(context.roots(input), context.reader).servers.find(
    (candidate) => candidate.name === name,
  )
  if (!server) {
    throw new McpConfigurationError({
      reason: 'not-found',
      message: `No MCP server named "${name}" is configured.`,
    })
  }
  return server
}

function buildView(
  context: ServiceContext,
  input: McpConfigurationScopeInput,
): McpConfigurationView {
  const roots = context.roots(input)
  const merged = loadMcpMergedConfig(roots, context.reader)
  const files: McpConfigFileView[] = mcpConfigFileLocations(roots).map((file) => ({
    fileId: file.fileId,
    path: file.path,
    scope: file.scope,
    exists: context.reader.readText(file.path) !== undefined,
    openWaggleOwned: isOpenWaggleMcpConfigFile(file.fileId),
  }))
  return {
    projectPath: input.projectPath,
    files,
    servers: merged.servers.map(serverView),
    errors: merged.errors,
  }
}

function setEnabled(context: ServiceContext, input: McpSetServerEnabledInput) {
  const server = findServer(context, input, input.name)
  if (input.target === 'project' && input.destination) assertProjectDestination(input.destination)
  if (input.target === 'project' && server.scope === 'global') {
    const projectOverride =
      server.override && mcpConfigFileScope(server.override.fileId) === 'project'
        ? server.override.path
        : undefined
    const filePath = input.destination
      ? fileFor(context, input, input.destination)
      : (projectOverride ?? fileFor(context, input, 'project-openwaggle'))
    updateMcpServerSettings(filePath, input.name, { enabled: input.enabled }, { override: true })
    return filePath
  }
  const filePath = server.override?.path ?? server.source.path
  updateMcpServerSettings(
    filePath,
    input.name,
    { enabled: input.enabled },
    {
      override: server.override !== undefined,
    },
  )
  return filePath
}

function setExposure(context: ServiceContext, input: McpSetServerExposureInput) {
  const server = findServer(context, input, input.name)
  const filePath = server.override?.path ?? server.source.path
  updateMcpServerSettings(
    filePath,
    input.name,
    {
      ...(input.exposure ? { exposure: input.exposure } : {}),
      ...(input.toolExposure ? { toolExposure: input.toolExposure } : {}),
      ...(server.override && server.config.toolExposure
        ? { inheritedToolExposure: server.config.toolExposure }
        : {}),
    },
    { override: server.override !== undefined },
  )
  return filePath
}

function addServer(context: ServiceContext, input: McpAddServerInput) {
  const destination: McpWriteDestination =
    input.destination ?? (input.scope === 'global' ? 'openwaggle-global' : 'project-openwaggle')
  assertDestinationInScope(destination, input.scope)
  assertNoProjectAuth(destination, input.entry)
  assertPiReadableDestination(destination, input.entry)
  const merged = loadMcpMergedConfig(context.roots(input), context.reader)
  assertNameFree(merged.servers, input.name, { replace: input.replace === true })
  const validated = validateMcpServerEntry(input.name, input.entry, {
    allowSecretReferences: isOpenWaggleMcpConfigFile(destination),
  })
  if (!validated.ok) {
    throw new McpConfigurationError({ reason: 'validation', message: validated.error })
  }
  const filePath = fileFor(context, input, destination)
  addMcpServerEntry(filePath, input.name, input.entry)
  return filePath
}

function removeServer(context: ServiceContext, input: McpRemoveServerInput) {
  const server = findServer(context, input, input.name)
  removeMcpServerEntry(server.source.path, input.name)
  return [server.source.path, ...removeOrphanedOverrides(context, input, input.name)]
}

/**
 * Once no file defines the server, its override-only entries would be config errors. Those in
 * OpenWaggle's files are removed with it; those in Pi's and shared files are left as they are and
 * show up in the view's errors. While an earlier file still defines the server, they stay.
 */
function removeOrphanedOverrides(
  context: ServiceContext,
  input: McpConfigurationScopeInput,
  name: string,
) {
  const roots = context.roots(input)
  if (loadMcpMergedConfig(roots, context.reader).servers.some((server) => server.name === name)) {
    return []
  }
  const removed: string[] = []
  for (const layer of readMcpConfigLayers(mcpConfigFileLocations(roots), context.reader)) {
    if (!isOpenWaggleMcpConfigFile(layer.fileId) || layer.content.kind !== 'parsed') continue
    const servers = isJsonRecord(layer.content.value) ? layer.content.value.mcpServers : undefined
    const entry = isJsonRecord(servers) ? servers[name] : undefined
    if (!isJsonRecord(entry) || 'command' in entry || 'url' in entry) continue
    removeMcpServerEntry(layer.path, name)
    removed.push(layer.path)
  }
  return removed
}

export function createFilesystemMcpConfigurationService(
  options: FilesystemMcpConfigurationOptions,
): McpConfigurationServiceShape {
  const context: ServiceContext = {
    reader: options.reader ?? nodeMcpConfigFileReader,
    roots: (input) => ({
      homeDir: options.homeDir,
      piAgentDir: options.piAgentDir,
      projectPath: input.projectPath,
    }),
  }
  const listeners = new Set<(filePath: string) => void>()
  const notify = (filePath: string) => {
    for (const listener of listeners) listener(filePath)
  }
  const write = (operation: () => string | readonly string[]) =>
    Effect.try({
      try: () => {
        const changed = operation()
        for (const filePath of typeof changed === 'string' ? [changed] : changed) notify(filePath)
      },
      catch: (error) =>
        error instanceof McpConfigurationError
          ? error
          : new McpConfigurationError({ reason: 'io', message: describe(error) }),
    })

  return {
    getView: (input) =>
      Effect.try({
        try: () => buildView(context, input),
        catch: (error) => new McpConfigurationError({ reason: 'io', message: describe(error) }),
      }),
    setServerEnabled: (input) => write(() => setEnabled(context, input)),
    setServerExposure: (input) => write(() => setExposure(context, input)),
    addServer: (input) => write(() => addServer(context, input)),
    removeServer: (input) => write(() => removeServer(context, input)),
    changed: notify,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
