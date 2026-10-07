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
import { type LegacyStateFile, legacyServerMap } from './legacy-state'
import type { McpMigrationFs } from './migration-fs'
import { globalMcpPaths, migrationBackupPath, projectMcpPaths } from './migration-paths'
import { applyProjectStateOverrides } from './project-state-overrides'

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

export async function computeGlobalFile(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly original: string | undefined
}): Promise<FileComputation> {
  const paths = globalMcpPaths(input.sources.homeDir)
  if (input.original === undefined) return { text: undefined, changes: [] }
  const document = parseJsonDocument(paths.openwaggleGlobal, input.original)
  const piGlobal = await input.sources.readOnlyConfig(paths.piGlobal)
  const migrated = migrateServers(legacyServerMap(document.value), {
    filePath: paths.openwaggleGlobal,
    state: input.state,
    livePiConfigs: new Map(piGlobal ? [[paths.piGlobal, piGlobal]] : []),
    lowerLayers: [{ path: paths.piGlobal, servers: piServers(piGlobal) }],
  })
  return finish(document, migrated.servers, migrated.changes)
}

export async function computeProjectFile(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projectPath: string
  readonly original: string | undefined
}): Promise<FileComputation> {
  const { sources } = input
  const global = globalMcpPaths(sources.homeDir)
  const project = projectMcpPaths(input.projectPath)
  const document =
    input.original === undefined
      ? { value: {}, indent: '  ' }
      : parseJsonDocument(project.openwaggle, input.original)
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
  const projectServers = legacyServerMap(document.value)
  const migrated = migrateServers(projectServers, {
    filePath: project.openwaggle,
    state: input.state,
    livePiConfigs,
    lowerLayers,
  })
  const overridden = applyProjectStateOverrides(
    {
      projectPath: input.projectPath,
      state: input.state,
      legacyLayers: {
        openwaggleGlobal: {
          path: global.openwaggleGlobal,
          servers: legacyGlobal ? legacyServerMap(legacyGlobal) : {},
        },
        mcpJson: { path: project.mcpJson, servers: mcpJson ? legacyServerMap(mcpJson) : {} },
        openwaggleProject: { path: project.openwaggle, servers: projectServers },
      },
      lowerLayers,
    },
    migrated.servers,
  )
  return finish(document, overridden.servers, [...migrated.changes, ...overridden.changes])
}
