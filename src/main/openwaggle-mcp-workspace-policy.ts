import { lstatSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { mcpLocalRefusal } from './openwaggle-mcp-refusal-message'

interface WorkspaceGrantScope {
  readonly workspaceRoots: readonly string[]
  readonly sessionIds: ReadonlySet<string>
}

function isWithinRoot(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isMissingPath(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function canonicalExistingPath(input: string) {
  return realpathSync.native(path.resolve(input))
}

function assertCanonicalGrantRoot(root: string) {
  const absolute = path.resolve(root)
  const canonical = canonicalExistingPath(absolute)
  if (canonical !== absolute) {
    throw mcpLocalRefusal(
      'target_scope_denied',
      `Workspace grant changed after this server started: ${JSON.stringify(root)}.`,
    )
  }
  return canonical
}

function canonicalProjectPath(input: string) {
  const resolved = path.resolve(input)
  try {
    return { path: canonicalExistingPath(resolved), exists: true }
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }

  try {
    if (lstatSync(resolved).isSymbolicLink()) {
      throw new Error(`Project ${JSON.stringify(resolved)} is an unresolved symbolic link.`)
    }
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }

  const parent = path.dirname(resolved)
  if (parent === resolved) throw new Error(`Project ${JSON.stringify(resolved)} was not found.`)
  return {
    path: path.join(canonicalExistingPath(parent), path.basename(resolved)),
    exists: false,
  }
}

export function assertProjectAllowed(options: WorkspaceGrantScope, projectPath: string) {
  const candidate = canonicalProjectPath(projectPath)
  if (
    options.workspaceRoots.length > 0 &&
    !options.workspaceRoots.some((root) =>
      isWithinRoot(candidate.path, assertCanonicalGrantRoot(root)),
    )
  ) {
    throw mcpLocalRefusal(
      'target_scope_denied',
      `Project ${JSON.stringify(candidate.path)} is outside this server profile's workspace grants.`,
    )
  }
  if (!candidate.exists) {
    throw new Error(
      `Project ${JSON.stringify(candidate.path)} does not exist. Create it before starting a hosted MCP session or task.`,
    )
  }
  if (!statSync(candidate.path).isDirectory()) {
    throw new Error(`Project ${JSON.stringify(candidate.path)} is not a directory.`)
  }
  return candidate.path
}

export function canonicalizeExistingProjectPath(projectPath: string) {
  return assertProjectAllowed({ workspaceRoots: [], sessionIds: new Set() }, projectPath)
}
