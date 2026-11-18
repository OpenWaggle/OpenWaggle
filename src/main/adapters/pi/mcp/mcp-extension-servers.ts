import type { ExtensionAPI, McpServerEntry } from '@earendil-works/pi-coding-agent'

/**
 * The MCP servers Pi extensions registered in a Run (`pi.registerMcpServer`), which never pass
 * through OpenWaggle's configuration. A Run's sign-in opener needs them to match a sign-in page
 * to its server; Settings lists only configured servers, so these sign in during a Run.
 */
export function createMcpExtensionServers() {
  let servers: readonly McpServerEntry[] = []
  return {
    /** Read on `session_start`, when the extensions have registered theirs. */
    capture(pi: Pick<ExtensionAPI, 'getMcpServers'>) {
      servers = pi.getMcpServers().map((server) => ({
        name: server.name,
        config: server.config,
        source: server.extensionPath,
        scope: 'extension' as const,
      }))
    },
    entries: () => servers,
  }
}
