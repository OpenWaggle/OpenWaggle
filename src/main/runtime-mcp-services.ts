import { Layer } from 'effect'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { FilesystemMcpConfigServiceLive } from './adapters/mcp/filesystem-mcp-config-service'
import { FirstPartyMcpRuntimeServiceLive } from './adapters/mcp/first-party-mcp-runtime-service'
import { McpTurnStateServiceLive } from './adapters/mcp/mcp-turn-state-service'

/** MCP configuration, secrets and runtime, provided to the app runtime and the Pi kernel. */
export const McpServicesLive = Layer.mergeAll(
  FilesystemMcpConfigServiceLive,
  EncryptedMcpSecretVaultServiceLive,
  FirstPartyMcpRuntimeServiceLive.pipe(Layer.provide(EncryptedMcpSecretVaultServiceLive)),
).pipe(Layer.provide(McpTurnStateServiceLive))
