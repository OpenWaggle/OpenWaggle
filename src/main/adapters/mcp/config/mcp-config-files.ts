import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  type McpConfigFileId,
  type McpConfigLayer,
  type McpConfigScope,
  mcpConfigFileScope,
} from '../../../domain/mcp/config/mcp-config-merge'

export interface McpConfigFileLocation {
  readonly fileId: McpConfigFileId
  readonly path: string
  readonly scope: McpConfigScope
}

export interface McpConfigFileRoots {
  /** The user's home directory; OpenWaggle's global file is `~/.openwaggle/mcp.json`. */
  readonly homeDir: string
  /** Pi's agent directory (`~/.pi/agent` unless `PI_CODING_AGENT_DIR` moves it). */
  readonly piAgentDir: string
  /** The durable project root, not a worktree working directory. Null outside a project. */
  readonly projectPath: string | null
}

const MCP_FILE_NAME = 'mcp.json'

function location(fileId: McpConfigFileId, filePath: string): McpConfigFileLocation {
  return { fileId, path: filePath, scope: mcpConfigFileScope(fileId) }
}

/**
 * The ADR 0051 file set in precedence order, lowest first. A file reached twice (a project that
 * is the home folder has `~/.openwaggle/mcp.json` as its project file) is read once, in its first
 * place.
 */
export function mcpConfigFileLocations(roots: McpConfigFileRoots): McpConfigFileLocation[] {
  const seen = new Set<string>()
  return allLocations(roots).filter((file) => {
    // By real path: a project folder that links to `~/.openwaggle` reaches the global file too.
    const key = realLocation(file.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Why a project has no OpenWaggle file of its own: it is the home folder, or its `.openwaggle`
 * folder links to `~/.openwaggle`. Either way its file is the global one.
 */
export const PROJECT_FILE_IS_GLOBAL =
  "This project's .openwaggle folder is the global one (the project is your home folder, or the folder links to ~/.openwaggle), so its mcp.json is the global file."

/**
 * Where a path really leads: the real path of its deepest part that exists (through links, in the
 * case the file system stores, as `realpathSync.native` gives it), with the rest of the path
 * after it. Two spellings of a folder that does not exist yet, below one that does, so agree.
 */
export function realLocation(filePath: string) {
  const resolved = path.resolve(filePath)
  const missing: string[] = []
  for (let current = resolved; ; current = path.dirname(current)) {
    try {
      return path.join(realpathSync.native(current), ...missing.reverse())
    } catch {
      if (path.dirname(current) === current) return resolved
      missing.push(path.basename(current))
    }
  }
}

function allLocations(roots: McpConfigFileRoots): McpConfigFileLocation[] {
  const global = [
    location('pi-global', path.join(roots.piAgentDir, MCP_FILE_NAME)),
    location('openwaggle-global', path.join(roots.homeDir, '.openwaggle', MCP_FILE_NAME)),
  ]
  if (!roots.projectPath) return global
  return [
    ...global,
    location('project-mcp-json', path.join(roots.projectPath, '.mcp.json')),
    location('project-pi', path.join(roots.projectPath, '.pi', MCP_FILE_NAME)),
    location('project-openwaggle', path.join(roots.projectPath, '.openwaggle', MCP_FILE_NAME)),
  ]
}

/** OpenWaggle's file for a scope: where new servers and per-project switches are written. */
export function openWaggleMcpConfigPath(roots: McpConfigFileRoots, scope: McpConfigScope) {
  if (scope === 'global') return path.join(roots.homeDir, '.openwaggle', MCP_FILE_NAME)
  if (!roots.projectPath) throw new Error('A project is required for a project MCP file.')
  return path.join(roots.projectPath, '.openwaggle', MCP_FILE_NAME)
}

function isMissingFile(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export interface McpConfigFileReader {
  /** Returns the file text, or undefined when it does not exist. */
  readonly readText: (filePath: string) => string | undefined
}

function lstatIfPresent(filePath: string) {
  try {
    return lstatSync(filePath)
  } catch {
    return undefined
  }
}

function resolves(filePath: string) {
  try {
    statSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Why a path that does not resolve is not simply missing: the file, or one of its folders, is a
 * symbolic link whose target does not exist (a dotfiles checkout not mounted). The nearest part
 * of the path that exists decides; a link there that resolves leaves the file missing below it.
 */
export function danglingMcpFileLink(filePath: string) {
  for (let current = filePath; ; current = path.dirname(current)) {
    const stats = lstatIfPresent(current)
    if (stats) {
      if (!stats.isSymbolicLink() || resolves(current)) return undefined
      return current === filePath
        ? 'links to a missing file'
        : `${current} links to a missing folder`
    }
    if (path.dirname(current) === current) return undefined
  }
}

export const nodeMcpConfigFileReader: McpConfigFileReader = {
  readText(filePath) {
    try {
      return readFileSync(filePath, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) throw error
      // Not missing: read as missing, its overrides elsewhere would count as removable orphans.
      const dangling = danglingMcpFileLink(filePath)
      if (dangling) throw new Error(dangling, { cause: error })
      return undefined
    }
  },
}

function readLayer(file: McpConfigFileLocation, reader: McpConfigFileReader): McpConfigLayer {
  let text: string | undefined
  try {
    text = reader.readText(file.path)
  } catch (error) {
    return {
      fileId: file.fileId,
      path: file.path,
      content: { kind: 'unreadable', error: errorMessage(error) },
    }
  }
  if (text === undefined)
    return { fileId: file.fileId, path: file.path, content: { kind: 'missing' } }
  // An empty file is an empty configuration, as an editor may leave it.
  if (!text.trim()) {
    return { fileId: file.fileId, path: file.path, content: { kind: 'parsed', value: {} } }
  }
  try {
    const value: unknown = JSON.parse(text)
    return { fileId: file.fileId, path: file.path, content: { kind: 'parsed', value } }
  } catch (error) {
    return {
      fileId: file.fileId,
      path: file.path,
      content: { kind: 'unreadable', error: errorMessage(error) },
    }
  }
}

export function readMcpConfigLayers(
  files: readonly McpConfigFileLocation[],
  reader: McpConfigFileReader = nodeMcpConfigFileReader,
): McpConfigLayer[] {
  return files.map((file) => readLayer(file, reader))
}
