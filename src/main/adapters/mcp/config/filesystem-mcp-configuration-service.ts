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
} from './mcp-config-files'
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
      message: 'A project is required for a project MCP file.',
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
  const changed = [server.source.path]
  removeMcpServerEntry(server.source.path, input.name)
  // An override left behind would be an error once its server is gone.
  if (server.override && isOpenWaggleMcpConfigFile(server.override.fileId)) {
    removeMcpServerEntry(server.override.path, input.name)
    changed.push(server.override.path)
  }
  return changed
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
