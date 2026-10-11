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
  PROJECT_FILE_IS_GLOBAL,
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
import { duplicateMcpServerErrors } from './mcp-duplicate-servers'
import { removeEmptyOpenWaggleProjectFile } from './mcp-empty-project-file'
import { writeMcpServerSwitch } from './mcp-inherited-settings'
import { removeOrphanedOverride, removeOrphanedOverrides } from './mcp-orphaned-overrides'
import { loadMcpMergedConfig } from './mcp-runtime-config'

export interface FilesystemMcpConfigurationOptions {
  readonly homeDir: string
  readonly piAgentDir: string
  readonly reader?: McpConfigFileReader
  /**
   * The projects whose `.openwaggle/mcp.json` may override a global server; removing one removes
   * its override-only entries there too.
   */
  readonly knownProjectPaths?: () => Promise<readonly string[]>
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hasAuthorizationHeader(headers: Readonly<Record<string, unknown>> | undefined) {
  return Object.keys(headers ?? {}).some((header) => header.toLowerCase() === 'authorization')
}

/** The vault secrets the server's `env` or `headers` name. */
function vaultSecretsOf(config: McpMergedServer['config']) {
  const values = Object.values(('url' in config ? config.headers : config.env) ?? {})
  const names = new Set(
    values.flatMap((value) => (typeof value === 'string' ? [] : [value.secret])),
  )
  return [...names].sort()
}

/** A file that cannot be read (a link to a missing file, no permission) is still there. */
function fileExists(reader: McpConfigFileReader, filePath: string) {
  try {
    return reader.readText(filePath) !== undefined
  } catch {
    return true
  }
}

function serverView(server: McpMergedServer): McpConfiguredServerView {
  const { config } = server
  const isUrl = 'url' in config
  const vaultSecrets = vaultSecretsOf(config)
  return {
    name: server.name,
    transport: server.transport,
    target: isUrl ? config.url : [config.command, ...(config.args ?? [])].join(' '),
    ...(config.description ? { description: config.description } : {}),
    source: server.source,
    scope: server.scope,
    ...(server.override ? { override: server.override } : {}),
    ...(server.offByOverride ? { offByOverride: true } : {}),
    enabled: config.enabled !== false,
    exposure: config.exposure ?? 'codemode',
    toolExposure: config.toolExposure ?? {},
    usesOAuth: isUrl && !config.auth && !hasAuthorizationHeader(config.headers),
    ...(vaultSecrets.length > 0 ? { vaultSecrets } : {}),
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
        ? `${PROJECT_FILE_IS_GLOBAL} Change the server for every project instead.`
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
  const locations = mcpConfigFileLocations(roots)
  const files: McpConfigFileView[] = locations.map((file) => ({
    fileId: file.fileId,
    path: file.path,
    scope: file.scope,
    exists: fileExists(context.reader, file.path),
    openWaggleOwned: isOpenWaggleMcpConfigFile(file.fileId),
  }))
  return {
    projectPath: input.projectPath,
    files,
    servers: merged.servers.map(serverView),
    errors: [...merged.errors, ...duplicateMcpServerErrors(locations, context.reader)],
    ...(merged.warnings ? { warnings: merged.warnings } : {}),
    ...(merged.orphanedOverrides ? { orphanedOverrides: merged.orphanedOverrides } : {}),
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
    writeMcpServerSwitch(context.roots(input), context.reader, filePath, input.name, input.enabled)
    return filePath
  }
  if (server.override) {
    const roots = context.roots(input)
    writeMcpServerSwitch(roots, context.reader, server.override.path, input.name, input.enabled)
    return server.override.path
  }
  updateMcpServerSettings(server.source.path, input.name, { enabled: input.enabled })
  return server.source.path
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
  const merged = loadMcpMergedConfig(context.roots(input), context.reader)
  assertNameFree(merged.servers, input.name, { replace: input.replace === true })
  const validated = validateMcpServerEntry(input.name, input.entry, {
    allowSecretReferences: isOpenWaggleMcpConfigFile(destination),
  })
  if (!validated.ok) {
    throw new McpConfigurationError({ reason: 'validation', message: validated.error })
  }
  assertPiReadableDestination(destination, validated.server.transport)
  const filePath = fileFor(context, input, destination)
  addMcpServerEntry(filePath, input.name, input.entry)
  return filePath
}

function orphanContext(context: ServiceContext, input: McpConfigurationScopeInput) {
  return { roots: context.roots(input), reader: context.reader }
}

function removeServer(
  context: ServiceContext,
  input: McpRemoveServerInput,
  knownProjects: readonly string[],
) {
  const server = findServer(context, input, input.name)
  removeMcpServerEntry(server.source.path, input.name)
  const changed = [
    server.source.path,
    ...removeOrphanedOverrides(orphanContext(context, input), input.name),
  ]
  if (server.scope !== 'global') return changed
  for (const projectPath of new Set(knownProjects)) {
    if (projectPath === input.projectPath) continue
    changed.push(...removeOrphanedOverrides(orphanContext(context, { projectPath }), input.name))
  }
  return [...new Set(changed)]
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
        for (const filePath of typeof changed === 'string' ? [changed] : changed) {
          removeEmptyOpenWaggleProjectFile(filePath, options.homeDir)
          notify(filePath)
        }
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
    removeServer: (input) =>
      Effect.promise(async () => (await options.knownProjectPaths?.().catch(() => [])) ?? []).pipe(
        Effect.flatMap((projects) => write(() => removeServer(context, input, projects))),
      ),
    removeOrphanedOverride: (input) =>
      write(() => removeOrphanedOverride(orphanContext(context, input), input)),
    changed: notify,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
