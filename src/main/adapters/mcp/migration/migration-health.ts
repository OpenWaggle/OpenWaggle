/**
 * Which of OpenWaggle's MCP files the one-time migration failed to migrate in this process. Such
 * a file still has the old format, and none of the `enabled` overrides that keep old-off servers
 * off, so it is not loaded until a later run migrates it; the configuration reports why.
 */
import path from 'node:path'

const failures = new Map<string, string>()

/** The outcome of one file's migration: an error while it failed, nothing once it succeeded. */
export function recordMcpFileMigrationOutcome(filePath: string, error?: string) {
  const key = path.resolve(filePath)
  if (error === undefined) failures.delete(key)
  else failures.set(key, error)
}

/** Why the file's last migration in this process failed, or undefined. */
export function mcpFileMigrationFailure(filePath: string) {
  return failures.get(path.resolve(filePath))
}
