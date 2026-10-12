/**
 * Which of OpenWaggle's MCP files the one-time migration failed to migrate in this process. Such
 * a file still has the old format, and none of the `enabled` overrides that keep old-off servers
 * off, so it is not loaded until a later run migrates it; the configuration reports why.
 */
import path from 'node:path'
import { realLocation } from '../config/mcp-config-files'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'

interface Failure {
  /** The file as it was spelled and where it led when it failed. */
  readonly spellings: ReadonlySet<string>
  readonly error: string
}

let failures: readonly Failure[] = []

/**
 * A file's lexical spelling and where it leads now. Either matches: two spellings of one folder
 * are one file, and a file keeps its failure when its link later leads elsewhere (a dotfiles
 * checkout mounted again) until a migration succeeds.
 */
function spellingsOf(filePath: string) {
  return new Set([path.resolve(filePath), realLocation(filePath)])
}

function concerns(failure: Failure, spellings: ReadonlySet<string>) {
  return [...spellings].some((spelling) => failure.spellings.has(spelling))
}

/** The outcome of one file's migration: an error while it failed, nothing once it succeeded. */
export function recordMcpFileMigrationOutcome(filePath: string, error?: string) {
  const spellings = spellingsOf(filePath)
  const others = failures.filter((failure) => !concerns(failure, spellings))
  failures = error === undefined ? others : [...others, { spellings, error }]
}

/** Why the file's last migration in this process failed, or undefined. */
export function mcpFileMigrationFailure(filePath: string) {
  const spellings = spellingsOf(filePath)
  return failures.find((failure) => concerns(failure, spellings))?.error
}

export interface PendingMcpFileMigration {
  readonly path: string
  readonly error: string
}

/**
 * The OpenWaggle file of this scope (the global one, and the project's) whose migration is
 * failing. A write made meanwhile would be undone when the migration later succeeds and applies
 * the old on/off state, so writes wait until then.
 */
export function pendingMcpFileMigration(
  homeDir: string,
  projectPath: string | null,
): PendingMcpFileMigration | undefined {
  const files = [
    globalMcpPaths(homeDir).openwaggleGlobal,
    ...(projectPath ? [projectMcpPaths(projectPath).openwaggle] : []),
  ]
  for (const filePath of files) {
    const error = mcpFileMigrationFailure(filePath)
    if (error !== undefined) return { path: filePath, error }
  }
  return undefined
}
