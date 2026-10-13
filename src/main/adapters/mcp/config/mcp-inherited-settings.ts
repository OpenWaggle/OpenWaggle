import path from 'node:path'
import { isJsonRecord } from '../../../domain/mcp/config/mcp-server-config'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  nodeMcpConfigFileReader,
} from './mcp-config-files'
import { clearMcpServerOverrideEnabled, updateMcpServerSettings } from './mcp-config-writer'
import { loadMcpMergedConfig } from './mcp-runtime-config'

/** The files as they would read without `name`'s entry in `filePath`. */
function readerWithoutEntry(
  reader: McpConfigFileReader,
  filePath: string,
  name: string,
): McpConfigFileReader {
  const target = path.resolve(filePath)
  return {
    readText(candidate) {
      const text = reader.readText(candidate)
      if (text === undefined || path.resolve(candidate) !== target) return text
      try {
        const parsed: unknown = JSON.parse(text)
        if (!isJsonRecord(parsed) || !isJsonRecord(parsed.mcpServers)) return text
        const { [name]: _removed, ...servers } = parsed.mcpServers
        return JSON.stringify({ ...parsed, mcpServers: servers })
      } catch {
        return text
      }
    },
  }
}

/**
 * Whether `name` is on as the files below `filePath`'s entry for it leave it: the value a switch in
 * that entry overrides. Undefined when no other file defines the server.
 */
export function inheritedMcpServerEnabled(
  roots: McpConfigFileRoots,
  filePath: string,
  name: string,
  reader: McpConfigFileReader = nodeMcpConfigFileReader,
) {
  const merged = loadMcpMergedConfig(roots, readerWithoutEntry(reader, filePath, name))
  const server = merged.servers.find((candidate) => candidate.name === name)
  return server ? server.config.enabled !== false : undefined
}

/**
 * Saves a switch in an override-only entry. One back to what the files below give is taken out
 * instead of written as `enabled: true`: kept, it would stop a later change below, such as turning
 * the server off for every project, from reaching this one.
 */
export function writeMcpServerSwitch(
  roots: McpConfigFileRoots,
  reader: McpConfigFileReader,
  filePath: string,
  name: string,
  enabled: boolean,
) {
  if (inheritedMcpServerEnabled(roots, filePath, name, reader) === enabled) {
    clearMcpServerOverrideEnabled(filePath, name)
    return
  }
  updateMcpServerSettings(filePath, name, { enabled }, { override: true })
}
