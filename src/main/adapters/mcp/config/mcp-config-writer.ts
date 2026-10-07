import {
  isJsonRecord,
  isMcpOverrideEntry,
  type McpExposure,
} from '../../../domain/mcp/config/mcp-server-config'
import { editMcpServers } from './mcp-config-file-edit'

/**
 * Edits one server of an `mcp.json` and keeps the rest of the file: unrelated keys, unknown
 * fields, entry order, and its formatting (see `mcp-config-file-edit.ts`). The same rules as Pi's `updateMcpServerConfig`, so a
 * change made in Settings and one made by Pi's `/mcp` inside a Run land the same way.
 */

export interface McpServerSettingsPatch {
  readonly enabled?: boolean
  readonly exposure?: McpExposure
  /** Per-tool exposure to set; `null` removes a tool's entry. */
  readonly toolExposure?: Readonly<Record<string, McpExposure | null>>
  /**
   * The rules an entry without its own `toolExposure` inherits: an override's `toolExposure`
   * replaces the one below it, so the first per-tool change under an override starts from the
   * merged rules instead of dropping them.
   */
  readonly inheritedToolExposure?: Readonly<Record<string, McpExposure>>
}

type JsonRecord = Record<string, unknown>

function applyToolExposure(
  server: JsonRecord,
  patch: Readonly<Record<string, McpExposure | null>>,
  inherited: Readonly<Record<string, McpExposure>> = {},
) {
  const current = isJsonRecord(server.toolExposure) ? { ...server.toolExposure } : { ...inherited }
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
    if (patch.toolExposure) {
      applyToolExposure(server, patch.toolExposure, patch.inheritedToolExposure)
    }
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
