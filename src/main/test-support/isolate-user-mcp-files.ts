import { vi } from 'vitest'

/**
 * The one-time ADR 0048 migration of the user's MCP files runs against the real home directory
 * (`homedir()`), and many code paths start it: Run start, Settings and CLI reads and writes, MCP
 * App and sign-in requests. No test may migrate the developer's own `~/.openwaggle/mcp.json`, so
 * that entry point is a no-op in every test; the migration itself is tested through
 * `migrateOpenWaggleMcpFiles`, which takes its home directory as input.
 */
vi.mock('../adapters/pi/mcp/openwaggle-mcp-migration', () => ({
  migrateOpenWaggleMcpFilesOnce: async () => undefined,
}))
