import { createHash } from 'node:crypto'
import path from 'node:path'
import { realLocation } from '../config/mcp-config-files'

/**
 * The backup a migrated MCP file keeps. An opaque file name: it says 0048 because the migration
 * shipped under that ADR number before the ADR was renumbered to 0051, and changing it would
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

const BACKUP_DIRECTORY_HASH_LENGTH = 16

/** Where the old code kept a backup: next to the file. Still read, never written for projects. */
export function legacyMigrationBackupPath(filePath: string) {
  return `${filePath}${MCP_MIGRATION_BACKUP_SUFFIX}`
}

/**
 * Whether the file is the global OpenWaggle file, by its real location: a project whose
 * `.openwaggle` folder links to `~/.openwaggle` has the global file as its project file.
 */
export function isGlobalOpenWaggleMcpFile(filePath: string, homeDir: string) {
  return realLocation(filePath) === realLocation(globalMcpPaths(homeDir).openwaggleGlobal)
}

/**
 * The migration's one backup of a file. The global file's sits next to it in `~/.openwaggle`. A
 * project file's is kept in the user's OpenWaggle data, under the project folder's name and a hash
 * of the file's path, so it is never written into a repository where it could be committed.
 */
export function migrationBackupPath(filePath: string, homeDir: string) {
  const resolved = path.resolve(filePath)
  if (isGlobalOpenWaggleMcpFile(resolved, homeDir)) {
    // Beside the global file, whichever path reaches it.
    return legacyMigrationBackupPath(path.resolve(globalMcpPaths(homeDir).openwaggleGlobal))
  }
  const hash = createHash('sha256')
    .update(resolved)
    .digest('hex')
    .slice(0, BACKUP_DIRECTORY_HASH_LENGTH)
  const project = path.basename(path.dirname(path.dirname(resolved))) || 'project'
  return path.join(
    homeDir,
    '.openwaggle',
    'mcp',
    'backups',
    `${project}-${hash}`,
    `${path.basename(resolved)}${MCP_MIGRATION_BACKUP_SUFFIX}`,
  )
}

/** Where OpenWaggle keeps managed Session worktrees (`session-worktree-path.ts`). */
export function managedWorktreesRoot(homeDir: string) {
  return path.join(homeDir, '.openwaggle', 'worktrees')
}

export function isInside(child: string, parent: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
