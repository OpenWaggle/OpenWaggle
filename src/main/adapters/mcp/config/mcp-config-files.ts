import { readFileSync } from 'node:fs'
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
 * The ADR 0050 file set in precedence order, lowest first. A file reached twice (a project that
 * is the home folder has `~/.openwaggle/mcp.json` as its project file) is read once, in its first
 * place.
 */
export function mcpConfigFileLocations(roots: McpConfigFileRoots): McpConfigFileLocation[] {
  const seen = new Set<string>()
  return allLocations(roots).filter((file) => {
    const key = path.resolve(file.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

export const nodeMcpConfigFileReader: McpConfigFileReader = {
  readText(filePath) {
    try {
      return readFileSync(filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return undefined
      throw error
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
