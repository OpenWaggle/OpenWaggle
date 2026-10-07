import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/utils/validation'

/**
 * The MCP configuration files of ADR 0048, lowest priority first: Pi's and OpenWaggle's global
 * files, then the project's `.mcp.json`, Pi and OpenWaggle files.
 */
export function mcpConfigFilePaths(input: {
  readonly homeDir: string
  readonly projectPath: string
}) {
  return [
    path.join(input.homeDir, '.pi', 'agent', 'mcp.json'),
    path.join(input.homeDir, '.openwaggle', 'mcp.json'),
    path.join(input.projectPath, '.mcp.json'),
    path.join(input.projectPath, '.pi', 'mcp.json'),
    path.join(input.projectPath, '.openwaggle', 'mcp.json'),
  ]
}

function isMissingFile(error: unknown) {
  return isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function readServerNames(filePath: string) {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  if (!raw.trim()) return []
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error('expected a JSON object')
  const servers = parsed.mcpServers
  if (servers === undefined) return []
  if (!isRecord(servers)) throw new Error('`mcpServers` must be an object')
  return Object.keys(servers)
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read-only list of the MCP server names configured for a project: the keys of `mcpServers` in
 * every ADR 0048 file, without merging entries or validating them. A file that cannot be read is
 * reported in `errors` and contributes no names, so callers know the list may be incomplete.
 */
export async function listConfiguredMcpServerNames(input: {
  readonly homeDir: string
  readonly projectPath: string
}) {
  const names = new Set<string>()
  const errors: string[] = []
  for (const filePath of mcpConfigFilePaths(input)) {
    try {
      for (const name of await readServerNames(filePath)) names.add(name)
    } catch (error) {
      errors.push(`Invalid MCP config at ${filePath}: ${describe(error)}`)
    }
  }
  return { names: [...names].sort(), errors }
}
