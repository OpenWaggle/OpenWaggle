/** MCP import from tools whose configuration Pi and OpenWaggle do not read live. */

export const MCP_IMPORT_SOURCES = [
  'codex',
  'claude-code',
  'claude-desktop',
  'cursor',
  'vscode',
  'opencode',
  'zed',
  'windsurf',
] as const

export type ExternalMcpImportSource = (typeof MCP_IMPORT_SOURCES)[number]

/** Where an imported server goes: `~/.openwaggle/mcp.json` or `<project>/.openwaggle/mcp.json`. */
export type McpImportTarget = 'global' | 'project'

/** A server entry in Pi's `mcpServers` format (plus vault references, allowed in OpenWaggle files). */
export type PiMcpEntry = Record<string, unknown>

/**
 * Relation of a candidate to the target file: not there yet, already imported
 * unchanged, imported before but changed at the source since, or its name is
 * used by another server.
 */
export type McpImportStatus = 'new' | 'imported' | 'source-changed' | 'name-taken'

export interface ExternalMcpImportCandidate {
  readonly source: ExternalMcpImportSource
  readonly sourcePath: string
  readonly suggestedTarget: McpImportTarget
  /** The server's name in the source tool. */
  readonly name: string
  /** A Pi-valid server name for it (names may only use letters, digits, `_`, and `-`). */
  readonly targetName: string
  readonly entry: PiMcpEntry
  readonly fingerprint: string
  readonly warnings: readonly string[]
  readonly status: McpImportStatus
}

export interface ExternalMcpImportSourceError {
  readonly source: ExternalMcpImportSource
  readonly path: string
  readonly message: string
}

export interface ExternalMcpImportPreview {
  readonly candidates: readonly ExternalMcpImportCandidate[]
  readonly unavailableSources: readonly ExternalMcpImportSource[]
  readonly errors: readonly ExternalMcpImportSourceError[]
}

/**
 * Kept on imported entries as an extra field (Pi ignores unknown fields), so a
 * later preview can tell an unchanged import from a changed source.
 */
export interface McpImportProvenance {
  readonly source: ExternalMcpImportSource
  readonly sourcePath: string
  readonly sourceName: string
  readonly fingerprint: string
  readonly importedAt: string
}
