/**
 * What one OpenWaggle MCP file becomes. Reads are cached for files the
 * migration never writes (Pi files and `.mcp.json`); OpenWaggle's global file
 * is re-read because the run may already have migrated it.
 */
import { isRecord } from '@shared/utils/validation'
import {
  type EntryMigrationContext,
  type McpLayerServers,
  type McpServerMigrationChange,
  migrateLegacyEntry,
} from './entry-migration'
import {
  type JsonDocument,
  parseJsonDocument,
  serializeJsonDocument,
  withTopLevelKey,
} from './json-document'
import { preserveLegacyEnablement } from './legacy-enablement'
import { type LegacyStateFile, legacyServerMap } from './legacy-state'
import type { McpMigrationFs } from './migration-fs'
import { globalMcpPaths, migrationBackupPath, projectMcpPaths } from './migration-paths'

export interface FileComputation {
  /** The new file text, or undefined when the file stays as it is. */
  readonly text: string | undefined
  readonly changes: readonly McpServerMigrationChange[]
}

type JsonObject = Record<string, unknown>

/** Pi reads only `mcpServers`. */
function piServers(config: JsonObject | undefined) {
  return config && isRecord(config.mcpServers) ? config.mcpServers : {}
}

export class McpFileSources {
  private readonly cache = new Map<string, Promise<JsonObject | undefined>>()

  constructor(
    private readonly fs: McpMigrationFs,
    readonly homeDir: string,
    /** Pi's agent directory (PI_CODING_AGENT_DIR), where its global mcp.json is. */
    readonly piAgentDir: string,
  ) {}

  /** A file the migration only reads. Throws when it exists but is not a JSON object. */
  readOnlyConfig(filePath: string) {
    let cached = this.cache.get(filePath)
    if (!cached) {
      cached = this.readConfig(filePath)
      this.cache.set(filePath, cached)
    }
    return cached
  }

  /** A file's current content, uncached. */
  async readConfig(filePath: string) {
    const text = await this.fs.readText(filePath)
    return text === undefined ? undefined : parseJsonDocument(filePath, text).value
  }

  /** A file as the old code saw it: its migration backup if one exists, else its content. */
  async legacyConfig(filePath: string) {
    const backup = await this.fs.readText(migrationBackupPath(filePath))
    if (backup !== undefined) return parseJsonDocument(filePath, backup).value
    return this.readConfig(filePath)
  }
}

function migrateServers(servers: JsonObject, context: EntryMigrationContext) {
  const next: JsonObject = {}
  const changes: McpServerMigrationChange[] = []
  for (const [name, value] of Object.entries(servers)) {
    const migrated = migrateLegacyEntry(name, value, context)
    if (migrated.entry !== undefined) next[name] = migrated.entry
    if (migrated.change) changes.push(migrated.change)
  }
  return { servers: next, changes }
}

function finish(
  document: JsonDocument,
  servers: JsonObject,
  changes: readonly McpServerMigrationChange[],
): FileComputation {
  const value = document.value
  const usesAlias = !isRecord(value.mcpServers) && isRecord(value.servers)
  if (!isRecord(value.mcpServers) && !usesAlias && Object.keys(servers).length === 0) {
    return { text: undefined, changes }
  }
  const nextValue = withTopLevelKey(
    value,
    'mcpServers',
    servers,
    usesAlias ? 'servers' : 'mcpServers',
  )
  if (JSON.stringify(nextValue) === JSON.stringify(value)) return { text: undefined, changes }
  return { text: serializeJsonDocument({ ...document, value: nextValue }), changes }
}

const EMPTY_DOCUMENT: JsonDocument = { value: {}, indent: '  ' }

function documentFor(filePath: string, original: string | undefined) {
  return original === undefined ? EMPTY_DOCUMENT : parseJsonDocument(filePath, original)
}

export interface FileComputationInput {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly original: string | undefined
  /** Write `enabled` overrides so each server stays as on or off as it was (see legacy-enablement). */
  readonly preserveEnablement: boolean
}

export async function computeGlobalFile(input: FileComputationInput): Promise<FileComputation> {
  const paths = globalMcpPaths(input.sources.homeDir, input.sources.piAgentDir)
  if (input.original === undefined && !input.preserveEnablement) {
    return { text: undefined, changes: [] }
  }
  const document = documentFor(paths.openwaggleGlobal, input.original)
  const piGlobal = await input.sources.readOnlyConfig(paths.piGlobal)
  const lowerLayers = [{ path: paths.piGlobal, servers: piServers(piGlobal) }]
  const legacyServers = legacyServerMap(document.value)
  const migrated = migrateServers(legacyServers, {
    livePiConfigs: new Map(piGlobal ? [[paths.piGlobal, piGlobal]] : []),
    lowerLayers,
  })
  if (!input.preserveEnablement) return finish(document, migrated.servers, migrated.changes)
  const preserved = preserveLegacyEnablement({
    scope: {
      state: input.state,
      projectPath: null,
      legacyLayers: [{ path: paths.openwaggleGlobal, servers: legacyServers }],
    },
    lowerLayers,
    ownPath: paths.openwaggleGlobal,
    servers: migrated.servers,
  })
  return finish(document, preserved.servers, [...migrated.changes, ...preserved.changes])
}

async function projectLayers(sources: McpFileSources, projectPath: string) {
  const global = globalMcpPaths(sources.homeDir, sources.piAgentDir)
  const project = projectMcpPaths(projectPath)
  const [piGlobal, projectPi, mcpJson, openwaggleGlobal, legacyGlobal] = await Promise.all([
    sources.readOnlyConfig(global.piGlobal),
    sources.readOnlyConfig(project.pi),
    sources.readOnlyConfig(project.mcpJson),
    sources.readConfig(global.openwaggleGlobal),
    sources.legacyConfig(global.openwaggleGlobal),
  ])
  const lowerLayers: McpLayerServers[] = [
    { path: global.piGlobal, servers: piServers(piGlobal) },
    {
      path: global.openwaggleGlobal,
      servers: openwaggleGlobal ? legacyServerMap(openwaggleGlobal) : {},
    },
    { path: project.mcpJson, servers: piServers(mcpJson) },
    { path: project.pi, servers: piServers(projectPi) },
  ]
  const livePiConfigs = new Map<string, JsonObject>()
  if (piGlobal) livePiConfigs.set(global.piGlobal, piGlobal)
  if (projectPi) livePiConfigs.set(project.pi, projectPi)
  const oldLayers: McpLayerServers[] = [
    { path: global.openwaggleGlobal, servers: legacyGlobal ? legacyServerMap(legacyGlobal) : {} },
    { path: project.mcpJson, servers: mcpJson ? legacyServerMap(mcpJson) : {} },
  ]
  return { lowerLayers, livePiConfigs, oldLayers }
}

export async function computeProjectFile(
  input: FileComputationInput & { readonly projectPath: string },
): Promise<FileComputation> {
  const projectFile = projectMcpPaths(input.projectPath).openwaggle
  const document = documentFor(projectFile, input.original)
  const { lowerLayers, livePiConfigs, oldLayers } = await projectLayers(
    input.sources,
    input.projectPath,
  )
  const projectServers = legacyServerMap(document.value)
  const migrated = migrateServers(projectServers, { livePiConfigs, lowerLayers })
  if (!input.preserveEnablement) return finish(document, migrated.servers, migrated.changes)
  const preserved = preserveLegacyEnablement({
    scope: {
      state: input.state,
      projectPath: input.projectPath,
      legacyLayers: [...oldLayers, { path: projectFile, servers: projectServers }],
    },
    lowerLayers,
    ownPath: projectFile,
    servers: migrated.servers,
  })
  return finish(document, preserved.servers, [...migrated.changes, ...preserved.changes])
}
