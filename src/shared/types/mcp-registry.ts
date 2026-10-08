/**
 * Requests and results of the MCP Registry operations of Settings > MCP and
 * `openwaggle mcp registry`. Installing writes an ordinary Pi entry to OpenWaggle's MCP file for
 * the chosen scope; nothing else is recorded about where it came from.
 */
import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpServerExposure,
} from './mcp-configuration'
import type { McpConfigurationScopeRequest } from './mcp-configuration-operations'

export const MCP_REGISTRY_PACKAGE_TYPES = ['npm', 'pypi', 'nuget', 'oci', 'mcpb'] as const

/** A package the Registry can describe and OpenWaggle can launch over stdio. */
export type McpRegistryPackageType = (typeof MCP_REGISTRY_PACKAGE_TYPES)[number]

/** How to run a Registry server: its hosted URL, or one of its packages. */
export type McpRegistryInstallMethod = 'remote' | McpRegistryPackageType

export interface McpRegistryInstallOptionView {
  readonly method: McpRegistryInstallMethod
  /** The URL, or the package identifier with its version. */
  readonly target: string
}

export interface McpRegistryServerView {
  /** The Registry name, such as `io.github.example/weather`. */
  readonly name: string
  readonly version: string
  readonly title?: string
  readonly description?: string
  readonly repositoryUrl?: string
  /** The name the server gets in the MCP file unless the user picks another. */
  readonly suggestedName: string
  /** Supported ways to run it, in the order an install without a method tries them. */
  readonly installOptions: readonly McpRegistryInstallOptionView[]
}

export interface McpRegistrySearchRequest {
  readonly query: string
  readonly limit?: number
  /** Another registry with the same API; HTTPS, or an explicit loopback URL. */
  readonly registryUrl?: string
}

export interface McpRegistrySearchResultView {
  readonly servers: readonly McpRegistryServerView[]
}

export interface McpRegistryServerRequest {
  readonly registryName: string
  /** Exact version; the latest when omitted. */
  readonly version?: string
  readonly registryUrl?: string
}

export interface McpRegistryInstallRequest
  extends McpConfigurationScopeRequest,
    McpRegistryServerRequest {
  readonly scope: McpConfigFileScope
  /** Defaults to the hosted URL when there is one, else the first supported package. */
  readonly method?: McpRegistryInstallMethod
  /** Defaults to the server's `suggestedName`. */
  readonly serverName?: string
  readonly exposure?: McpServerExposure
}

export interface McpRegistryInstallResultView {
  readonly name: string
  /** OpenWaggle's MCP file the entry was saved to. */
  readonly filePath: string
  /**
   * Vault secrets the entry reads, named `<SERVER>_<FIELD>`; the server fails to start until they
   * exist.
   */
  readonly secrets: readonly string[]
  /** Those of `secrets` the vault already holds, which the server uses as they are. */
  readonly existingSecrets: readonly string[]
  readonly view: McpConfigurationView
}
