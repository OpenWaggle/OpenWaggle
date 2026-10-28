import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { McpTransportFactory } from '@earendil-works/pi-coding-agent'
import { resolveDeferredMcpSecrets } from '../../mcp/config/mcp-deferred-secrets'
import type { McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import {
  MCP_CATALOG_FILL_WAIT_MS,
  type McpConnectionPool,
  mcpConnectionFingerprint,
  mcpServerIdentity,
  mcpStartupWaitMs,
} from '../../mcp/pool/mcp-connection-pool-api'
import { hardenedMcpAuthProvider } from './mcp-hardened-auth-provider'
import { mcpToolCatalogKeyOf } from './mcp-tool-catalogs'
import { mcpConnectionConfig } from './pi-mcp-server-oauth'
import { openPreparedPiMcpUpstream } from './pi-mcp-upstream'

/** What a Session's transports need of it (`OpenWaggleMcpSessionInput`). */
export interface OpenWaggleMcpTransportInput {
  readonly sessionId: string
  readonly pool: McpConnectionPool
  /** The durable project root, not the worktree a Run executes in. */
  readonly projectPath: string | null
  /** An Agent definition's MCP allowlist. */
  readonly serverAllowlist?: readonly string[]
}

/**
 * The transport of each server a Run connects: a lease on the Session's pooled connection. Servers
 * an Agent definition does not list are refused here too, since servers Pi extensions register
 * (`pi.registerMcpServer`) never pass through `loadConfig`.
 */
export function openWaggleMcpTransport(
  input: OpenWaggleMcpTransportInput,
  config: Pick<McpRuntimeConfig, 'transports'> &
    Partial<Pick<McpRuntimeConfig, 'connectionConfigs'>>,
): McpTransportFactory {
  return (entry, cwd, authProvider) => {
    if (input.serverAllowlist && !input.serverAllowlist.includes(entry.name)) {
      throw new Error(
        `This Session's Agent definition does not use the MCP server "${entry.name}".`,
      )
    }
    const transport =
      config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
    return input.pool.lease(input.sessionId, {
      name: entry.name,
      // Vault values by their stamp: deferred in one Run and read in the next, a server that is
      // turned on keeps its connection. Servers Pi extensions register are taken as given.
      fingerprint: mcpConnectionFingerprint({
        config: mcpConnectionConfig(config.connectionConfigs, entry),
        transport,
        cwd,
      }),
      identity: mcpServerIdentity(entry.name, entry.config),
      projectPath: input.projectPath,
      ...(entry.scope === 'extension' ? { fromExtension: true } : {}),
      // The last tools are declared at once, and a stdio server starts on first use (D1.3).
      catalogKey: mcpToolCatalogKeyOf({ entry, config, projectPath: input.projectPath }),
      lazyStart: transport === 'stdio',
      // The fill wait (and the runner probe, `openPreparedPiMcpUpstream`) take at most a third of
      // the server's timeout each.
      catalogFillWaitMs: mcpStartupWaitMs(entry.config.timeout, MCP_CATALOG_FILL_WAIT_MS),
      // A server that was off when the Run started reads its vault secrets only now.
      open: async () => {
        const resolved = {
          ...entry,
          config: await resolveDeferredMcpSecrets(entry.config, resolveMcpVaultSecret),
        }
        // The first spawn of an `npx` server already skips the runner (D1.2).
        const authorized = hardenedMcpAuthProvider(entry, authProvider)
        return openPreparedPiMcpUpstream({
          entry: resolved,
          transport,
          cwd,
          authProvider: authorized,
        })
      },
      roots: () => [{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) }],
    })
  }
}
