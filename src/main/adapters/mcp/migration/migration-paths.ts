import path from 'node:path'

export const MCP_MIGRATION_BACKUP_SUFFIX = '.pre-adr-0048.bak'

export function globalMcpPaths(homeDir: string) {
  return {
    piGlobal: path.join(homeDir, '.pi', 'agent', 'mcp.json'),
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
