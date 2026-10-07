import type {
  McpRegistryInstallMethod,
  McpRegistrySearchRequest,
  McpRegistrySearchResultView,
  McpRegistryServerRequest,
  McpRegistryServerView,
} from '@shared/types/mcp-registry'
import { Context, type Effect } from 'effect'
import type { McpConfigurationError } from './mcp-configuration-service'

export interface McpRegistryEntryRequest extends McpRegistryServerRequest {
  readonly method?: McpRegistryInstallMethod
}

/** A Registry server turned into an ordinary Pi `mcpServers` entry. */
export interface McpRegistryEntry {
  readonly suggestedName: string
  readonly entry: Readonly<Record<string, unknown>>
  /** Vault secrets the entry reads (`{ "secret": name }` values). */
  readonly secrets: readonly string[]
}

/**
 * The MCP Registry (registry.modelcontextprotocol.io): search, and preparing an entry for a
 * server. Preparing may download and verify an MCPB bundle into OpenWaggle's data directory or
 * pull an OCI image to pin its digest, but never writes an MCP file; the caller saves the entry.
 */
export interface McpRegistryServiceShape {
  readonly search: (
    input: McpRegistrySearchRequest,
  ) => Effect.Effect<McpRegistrySearchResultView, McpConfigurationError>
  readonly getServer: (
    input: McpRegistryServerRequest,
  ) => Effect.Effect<McpRegistryServerView, McpConfigurationError>
  readonly prepareEntry: (
    input: McpRegistryEntryRequest,
  ) => Effect.Effect<McpRegistryEntry, McpConfigurationError>
}

export class McpRegistryService extends Context.Tag('@openwaggle/McpRegistryService')<
  McpRegistryService,
  McpRegistryServiceShape
>() {}
