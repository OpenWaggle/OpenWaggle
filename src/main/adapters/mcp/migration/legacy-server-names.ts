/**
 * The old MCP client named a server instance by an ID in state.json (`servers[*].instanceId`,
 * keyed by the file that defined the server and its name), and Agent definitions and Session
 * profiles could list servers by that ID. ADR 0051 names servers only by name, so the migration
 * records which name each ID stood for.
 */
import { isRecord } from '@shared/utils/validation'
import { mcpServerIdentity } from '../pool/mcp-server-identity'
import type { McpFileSources } from './file-computation'
import { legacyServerIdentityKey } from './legacy-pi-import'
import { type LegacyStateFile, legacyServerMap } from './legacy-state'
import { type McpMigrationFs, nodeMcpMigrationFs } from './migration-fs'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'
import { type McpLegacyServerIdentity, McpMigrationRecord } from './migration-record'

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

/** The identity of what an old entry ran or connected to, as `mcpServerIdentity` makes it. */
function legacyEntryIdentity(name: string, entry: unknown) {
  if (!isRecord(entry)) return undefined
  if (typeof entry.url === 'string') return mcpServerIdentity(name, { url: entry.url })
  if (typeof entry.command !== 'string') return undefined
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  return mcpServerIdentity(name, { command: entry.command, args })
}

/** For every server in the files the old code read: its name and what it was, by instance ID. */
export async function legacyServerRecords(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projects: readonly string[]
}) {
  const names = new Map<string, string>()
  const identities = new Map<string, McpLegacyServerIdentity>()
  if (Object.keys(input.state.servers).length === 0) return { names, identities }
  for (const filePath of legacyServerFiles(input.sources, input.projects)) {
    // As the old code saw the file: a migrated file is read from its backup.
    const config = await input.sources.legacyConfig(filePath).catch(() => undefined)
    if (!isRecord(config)) continue
    for (const [name, entry] of Object.entries(legacyServerMap(config))) {
      const server = input.state.servers[legacyServerIdentityKey(filePath, name)]
      if (!server || names.has(server.instanceId)) continue
      names.set(server.instanceId, name)
      const identity = legacyEntryIdentity(name, entry)
      if (identity) {
        identities.set(server.instanceId, {
          identity,
          ...(server.trustedConfigHash ? { configHash: server.trustedConfigHash } : {}),
        })
      }
    }
  }
  return { names, identities }
}

/** What the migration recorded about old servers; empty when it has not run or cannot be read. */
export async function readLegacyMcpServerIdentities(
  homeDir: string,
  fs: McpMigrationFs = nodeMcpMigrationFs,
): Promise<ReadonlyMap<string, McpLegacyServerIdentity>> {
  try {
    return (await McpMigrationRecord.load(fs, homeDir)).legacyServerIdentities
  } catch {
    return new Map()
  }
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
