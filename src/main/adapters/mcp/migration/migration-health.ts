/**
 * Which of OpenWaggle's MCP files the one-time migration failed to migrate in this process. Such
 * a file still has the old format, and none of the `enabled` overrides that keep old-off servers
 * off, so it is not loaded until a later run migrates it; the configuration reports why.
 */
import path from 'node:path'
import { realLocation } from '../config/mcp-config-files'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'

/**
 * Why a migration failed. `content`: a file it reads cannot be (its JSON, a link into a missing
 * folder), which lasts until the user fixes it. `wait`: something it waited for did not answer in
 * time (another process's lock), which passes by itself.
 */
export type McpMigrationFailureCause = 'content' | 'wait'

export interface McpMigrationFailureDetails {
  readonly cause?: McpMigrationFailureCause
  /** The file to fix for a `content` failure, when it is not the migrated file itself. */
  readonly source?: string
  /**
   * Whether old on/off state is waiting to be applied (OpenWaggle had an MCP setup, or that is
   * not decided yet). Without it, the migration only converts the format: nothing to undo.
   */
  readonly keepsLegacyState?: boolean
}

interface Failure extends Required<Omit<McpMigrationFailureDetails, 'source'>> {
  /** The file as it was recorded. */
  readonly path: string
  /** The file as it was spelled and where it led when it failed. */
  readonly spellings: ReadonlySet<string>
  readonly error: string
  readonly source?: string
}

let failures: readonly Failure[] = []

/**
 * A file's lexical spelling, where it leads now, and its folder's real location with the file's
 * last two parts. Any matches: two spellings of one folder are one file, and a file keeps its
 * failure when its link later leads elsewhere (a dotfiles checkout mounted again) until a
 * migration succeeds.
 */
function spellingsOf(filePath: string) {
  const resolved = path.resolve(filePath)
  // `<folder>/.openwaggle/mcp.json` by the folder's real location: any spelling of the project
  // matches, even after its `.openwaggle` link has come to lead elsewhere.
  const openWaggleFolder = path.dirname(resolved)
  const folder = path.dirname(openWaggleFolder)
  const tail = path.join(path.basename(openWaggleFolder), path.basename(resolved))
  return new Set([resolved, realLocation(filePath), path.join(realLocation(folder), tail)])
}

function concerns(failure: Failure, spellings: ReadonlySet<string>) {
  return [...spellings].some((spelling) => failure.spellings.has(spelling))
}

/**
 * The outcome of one file's migration: an error while it failed, nothing once it succeeded. A
 * failure is taken as a lasting one that keeps old state waiting unless said otherwise.
 */
export function recordMcpFileMigrationOutcome(
  filePath: string,
  error?: string,
  details: McpMigrationFailureDetails = {},
) {
  const spellings = spellingsOf(filePath)
  const others = failures.filter((failure) => !concerns(failure, spellings))
  if (error === undefined) {
    failures = others
    return
  }
  const failure: Failure = {
    path: path.resolve(filePath),
    spellings,
    error,
    cause: details.cause ?? 'content',
    keepsLegacyState: details.keepsLegacyState ?? true,
    ...(details.source ? { source: details.source } : {}),
  }
  failures = [...others, failure]
}

function failureOf(filePath: string) {
  const spellings = spellingsOf(filePath)
  return failures.find((failure) => concerns(failure, spellings))
}

/** The file's failing migration with its cause, or undefined. */
export function mcpFileMigrationPending(filePath: string): PendingMcpFileMigration | undefined {
  const failure = failureOf(filePath)
  return failure ? pending(failure, path.resolve(filePath)) : undefined
}

export interface PendingMcpFileMigration {
  readonly path: string
  readonly error: string
  readonly cause: McpMigrationFailureCause
  readonly source?: string
  readonly keepsLegacyState: boolean
}

/**
 * The files a write may need migrated first. `all`: the global file and the viewed project's.
 * `global`: the global file and the viewed project's, then any other project whose old state
 * waits for the migration lock (`blocksGlobalWrites`), since that project's migration would write
 * overrides over what a global write changed. `everywhere`: the same.
 */
export type McpPendingScope = 'all' | 'global' | 'everywhere'

function pending(failure: Failure, filePath = failure.path): PendingMcpFileMigration {
  const { spellings: _spellings, path: _path, ...details } = failure
  return { path: filePath, ...details }
}

/**
 * Whether another project's failure holds back a global write: only while its migration waits for
 * the lock, which passes by itself. One the user must fix (an unmounted dotfiles checkout) would
 * hold every global change back for good; that project keeps its old on/off choices once it is
 * updated, over what changed meanwhile, as it had them.
 */
function blocksGlobalWrites(failure: Failure) {
  return failure.keepsLegacyState && failure.cause === 'wait'
}

/**
 * The OpenWaggle file of this scope whose migration is failing. A write made meanwhile would be
 * undone when the migration later succeeds and applies the old on/off state, so writes wait.
 * Beyond `all`, a failure that keeps no old state undoes nothing, so the search looks past it.
 */
export function pendingMcpFileMigration(
  homeDir: string,
  projectPath: string | null,
  scope: McpPendingScope = 'all',
): PendingMcpFileMigration | undefined {
  const files = [
    globalMcpPaths(homeDir).openwaggleGlobal,
    ...(projectPath ? [projectMcpPaths(projectPath).openwaggle] : []),
  ]
  for (const filePath of files) {
    const failure = failureOf(filePath)
    if (failure && (scope === 'all' || failure.keepsLegacyState)) return pending(failure, filePath)
  }
  if (scope === 'all') return undefined
  const elsewhere = failures.find(blocksGlobalWrites)
  return elsewhere ? pending(elsewhere) : undefined
}

/** For tests: forgets every recorded failure, as a new Host process starts with none. */
export function forgetMcpFileMigrationOutcomes() {
  failures = []
}

/**
 * The projects whose migration waited for the lock while their old state waits: a global write
 * waits for them, so it migrates them again first, as the lock may be free since.
 */
export function pendingKeptProjects(homeDir: string) {
  const global = path.resolve(globalMcpPaths(homeDir).openwaggleGlobal)
  return failures
    .filter((failure) => blocksGlobalWrites(failure) && failure.path !== global)
    .map((failure) => ({
      projectPath: path.dirname(path.dirname(failure.path)),
      pending: pending(failure),
    }))
}
