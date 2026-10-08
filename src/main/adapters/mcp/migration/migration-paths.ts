import path from 'node:path'

/**
 * The backup a migrated MCP file keeps. An opaque file name: it says 0048 because the migration
 * shipped under that ADR number before the ADR was renumbered to 0050, and changing it would
 * stop the migration from finding backups it already wrote.
 */
export const MCP_MIGRATION_BACKUP_SUFFIX = '.pre-adr-0048.bak'

/** Pi's agent directory when PI_CODING_AGENT_DIR does not move it. */
export function defaultPiAgentDir(homeDir: string) {
  return path.join(homeDir, '.pi', 'agent')
}

export function globalMcpPaths(homeDir: string, piAgentDir = defaultPiAgentDir(homeDir)) {
  return {
    piGlobal: path.join(piAgentDir, 'mcp.json'),
    openwaggleGlobal: path.join(homeDir, '.openwaggle', 'mcp.json'),
    legacyState: path.join(homeDir, '.openwaggle', 'mcp', 'state.json'),
  }
}

export function projectMcpPaths(projectPath: string) {
  return {
    mcpJson: path.join(projectPath, '.mcp.json'),
    pi: path.join(projectPath, '.pi', 'mcp.json'),
    openwaggle: path.join(projectPath, '.openwaggle', 'mcp.json'),
  }
}

export function migrationBackupPath(filePath: string) {
  return `${filePath}${MCP_MIGRATION_BACKUP_SUFFIX}`
}
