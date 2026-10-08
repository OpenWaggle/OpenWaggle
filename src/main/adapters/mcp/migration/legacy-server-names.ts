/**
 * The old MCP client named a server instance by an ID in state.json (`servers[*].instanceId`,
 * keyed by the file that defined the server and its name), and Agent definitions and Session
 * profiles could list servers by that ID. ADR 0048 names servers only by name, so the migration
 * records which name each ID stood for.
 */
import { isRecord } from '@shared/utils/validation'
import type { McpFileSources } from './file-computation'
import { legacyServerIdentityKey } from './legacy-pi-import'
import { type LegacyStateFile, legacyServerMap } from './legacy-state'
import { type McpMigrationFs, nodeMcpMigrationFs } from './migration-fs'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'
import { McpMigrationRecord } from './migration-record'

/** The files the old code read: the global OpenWaggle file, and each project's two files. */
function legacyServerFiles(sources: McpFileSources, projects: readonly string[]) {
  return [
    globalMcpPaths(sources.homeDir, sources.piAgentDir).openwaggleGlobal,
    ...projects.flatMap((projectPath) => {
      const paths = projectMcpPaths(projectPath)
      return [paths.mcpJson, paths.openwaggle]
    }),
  ]
}

/** Old instance ID to server name for every server in the files the old code read. */
export async function legacyServerNames(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projects: readonly string[]
}) {
  const names = new Map<string, string>()
  if (Object.keys(input.state.servers).length === 0) return names
  for (const filePath of legacyServerFiles(input.sources, input.projects)) {
    // As the old code saw the file: a migrated file is read from its backup.
    const config = await input.sources.legacyConfig(filePath).catch(() => undefined)
    if (!isRecord(config)) continue
    for (const name of Object.keys(legacyServerMap(config))) {
      const instanceId = input.state.servers[legacyServerIdentityKey(filePath, name)]?.instanceId
      if (instanceId && !names.has(instanceId)) names.set(instanceId, name)
    }
  }
  return names
}

/** What the migration recorded; empty when it has not run or its record cannot be read. */
export async function readLegacyMcpServerNames(
  homeDir: string,
  fs: McpMigrationFs = nodeMcpMigrationFs,
): Promise<ReadonlyMap<string, string>> {
  try {
    return (await McpMigrationRecord.load(fs, homeDir)).legacyServerNames
  } catch {
    return new Map()
  }
}
