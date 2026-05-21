import type {
  McpAdapterSettings,
  McpEffectiveConfig,
  McpServerMap,
  McpServerSummary,
} from '@shared/types/mcp'
import { getImports, getSettings, mergeImports, mergeSettings } from './config-accessors'
import type { LoadedSource } from './types'

function getServerTransport(entry: McpServerMap[string]) {
  if (typeof entry.url === 'string') {
    return 'http'
  }
  if (typeof entry.command === 'string') {
    return 'stdio'
  }
  return 'unknown'
}

function getDirectToolsMode(entry: McpServerMap[string]) {
  if (entry.directTools === true) {
    return 'enabled'
  }
  if (entry.directTools === false) {
    return 'disabled'
  }
  if (Array.isArray(entry.directTools)) {
    return 'partial'
  }
  return 'inherited'
}

export function buildEffectiveConfig(sources: readonly LoadedSource[]) {
  let settings: McpAdapterSettings = {}
  let imports: readonly string[] = []
  const activeServers: McpServerMap = {}
  const disabledServers: McpServerMap = {}

  for (const source of sources) {
    settings = mergeSettings(settings, getSettings(source.config))
    imports = mergeImports(imports, getImports(source.config))

    for (const [name, entry] of Object.entries(source.activeServers)) {
      activeServers[name] = entry
      delete disabledServers[name]
    }
    for (const [name, entry] of Object.entries(source.disabledServers)) {
      disabledServers[name] = entry
      delete activeServers[name]
    }
  }

  return {
    mcpServers: activeServers,
    disabledMcpServers: disabledServers,
    settings,
    imports,
  }
}

export function buildSourceSummary(source: LoadedSource) {
  return {
    id: source.definition.id,
    label: source.definition.label,
    path: source.definition.path,
    scope: source.definition.scope,
    kind: source.definition.kind,
    exists: source.exists,
    editable: source.definition.editable,
    serverCount: Object.keys(source.activeServers).length,
    disabledServerCount: Object.keys(source.disabledServers).length,
    rawJson: source.rawJson,
    ...(source.parseError ? { parseError: source.parseError } : {}),
  }
}

function buildServerSummary(
  source: LoadedSource,
  name: string,
  entry: McpServerMap[string],
  enabled: boolean,
): McpServerSummary {
  return {
    name,
    enabled,
    sourceId: source.definition.id,
    sourceLabel: source.definition.label,
    sourcePath: source.definition.path,
    ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
    ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
    transport: getServerTransport(entry),
    directTools: getDirectToolsMode(entry),
  }
}

export function buildServerSummaries(sources: readonly LoadedSource[]) {
  const summaries = new Map<string, McpServerSummary>()

  for (const source of sources) {
    for (const [name, entry] of Object.entries(source.activeServers)) {
      summaries.set(name, buildServerSummary(source, name, entry, true))
    }

    for (const [name, entry] of Object.entries(source.disabledServers)) {
      summaries.set(name, buildServerSummary(source, name, entry, false))
    }
  }

  return [...summaries.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function buildRuntimeConfigObject(effective: McpEffectiveConfig) {
  return {
    ...(effective.imports.length > 0 ? { imports: [...effective.imports] } : {}),
    ...(Object.keys(effective.settings).length > 0 ? { settings: effective.settings } : {}),
    mcpServers: effective.mcpServers,
  }
}

export function assertNoInvalidMcpSources(sources: readonly LoadedSource[]) {
  const invalidSources = sources.filter((source) => source.parseError)
  if (invalidSources.length === 0) {
    return
  }

  throw new Error(
    `Fix invalid MCP config before starting MCP: ${invalidSources
      .map((source) => source.parseError)
      .join('; ')}`,
  )
}
