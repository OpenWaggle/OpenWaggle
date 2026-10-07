import type { McpServerEntryInput } from '../types/mcp-configuration-operations'

export const MCP_LATEST_PROTOCOL_VERSION = '2026-07-28'

export interface McpCatalogServer {
  /** The server name its entry is saved under. */
  readonly name: string
  readonly title: string
  readonly description: string
  /** An ordinary Pi `mcpServers` entry. */
  readonly entry: McpServerEntryInput
}

/** Curated first-party catalog: a one-click install of an ordinary entry (ADR 0048). */
export const MCP_CATALOG_SERVERS: readonly McpCatalogServer[] = [
  {
    name: 'playwright',
    title: 'Playwright MCP',
    description: 'Browser automation and accessibility-tree inspection by Microsoft.',
    entry: { command: 'npx', args: ['@playwright/mcp@latest'] },
  },
  {
    name: 'chrome-devtools',
    title: 'Chrome DevTools MCP',
    description: 'Chrome DevTools debugging, performance traces, and network inspection by Google.',
    entry: { command: 'npx', args: ['chrome-devtools-mcp@latest'] },
  },
]

export const MCP_MODERN_PROTOCOL_VERSIONS = [MCP_LATEST_PROTOCOL_VERSION] as const

export const MCP_LEGACY_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  ...MCP_MODERN_PROTOCOL_VERSIONS,
  ...MCP_LEGACY_PROTOCOL_VERSIONS,
] as const

export const MCP_CONFIG = {
  JSON_INDENT_SPACES: 2,
  /** OpenWaggle's MCP data directory under the home directory: the encrypted vault lives here. */
  GLOBAL_STATE_DIR: ['.openwaggle', 'mcp'],
  GLOBAL_VAULT_FILE_NAME: 'vault.json',
  STATE_VERSION: 1,
  PROBE_TIMEOUT_MS: 3_000,
  MAX_RESULT_BYTES: 1_000_000,
} as const
