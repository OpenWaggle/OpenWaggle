/**
 * Which of OpenWaggle's MCP files the one-time migration failed to migrate in this process. Such
 * a file still has the old format, and none of the `enabled` overrides that keep old-off servers
 * off, so it is not loaded until a later run migrates it; the configuration reports why.
 */
import path from 'node:path'
import { realLocation } from '../config/mcp-config-files'

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
