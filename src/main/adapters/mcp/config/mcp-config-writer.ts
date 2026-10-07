import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  isJsonRecord,
  isMcpOverrideEntry,
  type McpExposure,
} from '../../../domain/mcp/config/mcp-server-config'

/**
 * Edits one server of an `mcp.json` and keeps the rest of the file: unrelated keys, unknown
 * fields, entry order, and its indentation. The same rules as Pi's `updateMcpServerConfig`, so a
 * change made in Settings and one made by Pi's `/mcp` inside a Run land the same way.
 */

export interface McpServerSettingsPatch {
  readonly enabled?: boolean
  readonly exposure?: McpExposure
  /** Per-tool exposure to set; `null` removes a tool's entry. */
  readonly toolExposure?: Readonly<Record<string, McpExposure | null>>
}

type JsonRecord = Record<string, unknown>

const DEFAULT_INDENT = '  '
const FILE_MODE = 0o600

function parseFile(filePath: string, text: string | undefined): JsonRecord {
  const parsed: unknown = text === undefined || !text.trim() ? {} : JSON.parse(text)
  if (
    !isJsonRecord(parsed) ||
    (parsed.mcpServers !== undefined && !isJsonRecord(parsed.mcpServers))
  ) {
    throw new Error(`${filePath}: expected an object with an "mcpServers" object`)
  }
  return parsed
}

function writeAtomically(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, content, { mode: FILE_MODE })
    renameSync(temporaryPath, filePath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Reads an `mcp.json` (empty when missing), lets `edit` change its `mcpServers`, and writes it back
 * with its indentation when `edit` returns true.
 */
function editMcpServers(
  filePath: string,
  edit: (servers: JsonRecord, parsed: JsonRecord) => boolean,
) {
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined
  const parsed = parseFile(filePath, text)
  const servers = isJsonRecord(parsed.mcpServers) ? parsed.mcpServers : {}
  if (!edit(servers, parsed)) return false
  parsed.mcpServers = servers
  const indent = (text && /^([ \t]+)\S/m.exec(text)?.[1]) || DEFAULT_INDENT
  writeAtomically(filePath, `${JSON.stringify(parsed, null, indent)}\n`)
  return true
}

function applyToolExposure(
  server: JsonRecord,
  patch: Readonly<Record<string, McpExposure | null>>,
) {
  const current = isJsonRecord(server.toolExposure) ? { ...server.toolExposure } : {}
  for (const [tool, exposure] of Object.entries(patch)) {
    if (exposure === null) delete current[tool]
    else current[tool] = exposure
  }
  if (Object.keys(current).length === 0) delete server.toolExposure
  else server.toolExposure = current
}

/**
 * Changes one server's settings in the file that defines or overrides it. With `override`, a
 * missing entry is added as an override-only entry. Full entries drop default values
 * (`enabled: true`, `exposure: "codemode"`); overrides keep them, since they replace a value an
 * earlier file set.
 */
export function updateMcpServerSettings(
  filePath: string,
  name: string,
  patch: McpServerSettingsPatch,
  options: { readonly override?: boolean } = {},
) {
  editMcpServers(filePath, (servers) => {
    let server = servers[name]
    if (server === undefined && options.override) {
      server = {}
      servers[name] = server
    }
    if (!isJsonRecord(server)) throw new Error(`${filePath} does not define MCP server "${name}"`)
    const keepDefaults = isMcpOverrideEntry(server)
    if (patch.enabled !== undefined) {
      if (patch.enabled && !keepDefaults) delete server.enabled
      else server.enabled = patch.enabled
    }
    if (patch.exposure !== undefined) {
      if (patch.exposure === 'codemode' && !keepDefaults) delete server.exposure
      else server.exposure = patch.exposure
    }
    if (patch.toolExposure) applyToolExposure(server, patch.toolExposure)
    return true
  })
}

/** Adds a server, creating the file when missing. Returns true when an entry was replaced. */
export function addMcpServerEntry(
  filePath: string,
  name: string,
  entry: Readonly<Record<string, unknown>>,
) {
  let replaced = false
  editMcpServers(filePath, (servers) => {
    replaced = servers[name] !== undefined
    servers[name] = { ...entry }
    return true
  })
  return replaced
}

/** Removes a server. Returns false when the file does not define it. */
export function removeMcpServerEntry(filePath: string, name: string) {
  if (!existsSync(filePath)) return false
  return editMcpServers(filePath, (servers) => {
    if (servers[name] === undefined) return false
    delete servers[name]
    return true
  })
}

/** What Pi's `updateConfig` receives: the entry `/mcp` changed and its patch. */
export interface McpUpdateConfigEntry {
  readonly name: string
  readonly source: string
  readonly override?: string
}

/**
 * Pi's `updateConfig` option: saves `/mcp` changes to the entry's override when it has one, else
 * to its defining file, then tells OpenWaggle the configuration changed.
 */
export function createMcpUpdateConfig(onChanged: (filePath: string) => void) {
  return (entry: McpUpdateConfigEntry, patch: McpServerSettingsPatch) => {
    const filePath = entry.override ?? entry.source
    updateMcpServerSettings(filePath, entry.name, patch, { override: entry.override !== undefined })
    onChanged(filePath)
  }
}
