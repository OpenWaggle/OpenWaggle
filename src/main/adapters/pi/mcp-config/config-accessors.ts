import type {
  McpAdapterSettings,
  McpConfigFile,
  McpPackageEntry,
  McpServerMap,
  PiAgentSettingsFile,
} from '@shared/types/mcp'
import { MCP_ADAPTER_PACKAGE_SOURCE, MCP_ADAPTER_PACKAGE_SOURCE_SET } from './constants'

export function getActiveServers(config: McpConfigFile) {
  return config.mcpServers ?? config['mcp-servers'] ?? {}
}

function getOpenWaggleConfig(config: McpConfigFile) {
  return config.openwaggle ?? {}
}

export function getDisabledServers(config: McpConfigFile) {
  return getOpenWaggleConfig(config).disabledMcpServers ?? {}
}

export function getSettings(config: McpConfigFile) {
  return config.settings ?? {}
}

export function getImports(config: McpConfigFile) {
  return config.imports ?? []
}

export function setActiveServers(config: McpConfigFile, servers: McpServerMap) {
  delete config['mcp-servers']
  config.mcpServers = servers
}

export function setDisabledServers(config: McpConfigFile, servers: McpServerMap) {
  const serverNames = Object.keys(servers)
  if (serverNames.length === 0) {
    const openwaggle = getOpenWaggleConfig(config)
    delete openwaggle.disabledMcpServers
    if (Object.keys(openwaggle).length === 0) {
      delete config.openwaggle
    } else {
      config.openwaggle = openwaggle
    }
    return
  }

  const openwaggle = getOpenWaggleConfig(config)
  openwaggle.disabledMcpServers = servers
  config.openwaggle = openwaggle
}

function getPackageSource(value: McpPackageEntry) {
  if (typeof value === 'string') {
    return value
  }
  return value.source
}

function getPackageEntries(settings: PiAgentSettingsFile) {
  return settings.packages ?? []
}

function packageSourceMatches(value: McpPackageEntry) {
  return MCP_ADAPTER_PACKAGE_SOURCE_SET.has(getPackageSource(value))
}

export function isAdapterEnabled(settings: PiAgentSettingsFile) {
  return getPackageEntries(settings).some(packageSourceMatches)
}

export function addAdapterPackageSource(settings: PiAgentSettingsFile) {
  const packages = [
    ...getPackageEntries(settings).filter((entry) => !packageSourceMatches(entry)),
    MCP_ADAPTER_PACKAGE_SOURCE,
  ]
  return { ...settings, packages }
}

export function removeAdapterPackageSource(settings: PiAgentSettingsFile) {
  return {
    ...settings,
    packages: getPackageEntries(settings).filter((entry) => !packageSourceMatches(entry)),
  }
}

export function mergeSettings(base: McpAdapterSettings, next: McpAdapterSettings) {
  return { ...base, ...next }
}

export function mergeImports(base: readonly string[], next: readonly string[]) {
  return [...new Set([...base, ...next])]
}
