import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpConfigSourceId, McpServerMap } from '@shared/types/mcp'
import { getIgnoredMcpServerFields } from '../../domain/mcp/server-policy'
import type {
  LoadedMcpSource,
  McpFilesystemConfigServiceOptions,
  McpSourceDefinition,
} from './config-types'
import { parseMcpConfigFileForView, readTextIfPresent } from './json-files'

const KNOWN_CONFIG_FIELDS = new Set(['mcpServers', 'servers', 'openwaggle'])

export function getMcpUserStatePath(options: McpFilesystemConfigServiceOptions) {
  return path.join(
    options.homeDir,
    ...MCP_CONFIG.GLOBAL_STATE_DIR,
    MCP_CONFIG.GLOBAL_STATE_FILE_NAME,
  )
}

export function getMcpConfigSources(
  options: McpFilesystemConfigServiceOptions,
  projectPath?: string | null,
) {
  const sources: McpSourceDefinition[] = [
    {
      id: 'global-openwaggle',
      label: 'Global OpenWaggle MCP',
      path: path.join(
        options.homeDir,
        ...MCP_CONFIG.GLOBAL_CONFIG_DIR,
        MCP_CONFIG.GLOBAL_CONFIG_FILE_NAME,
      ),
      scope: 'global',
      kind: 'openwaggle',
      editable: true,
    },
  ]

  const normalizedProjectPath = projectPath?.trim()
  if (!normalizedProjectPath) return sources

  sources.push(
    {
      id: 'project-standard',
      label: 'Project MCP',
      path: path.join(normalizedProjectPath, MCP_CONFIG.PROJECT_STANDARD_CONFIG_FILE_NAME),
      scope: 'project',
      kind: 'standard',
      editable: true,
    },
    {
      id: 'project-openwaggle',
      label: 'Project OpenWaggle MCP',
      path: path.join(
        normalizedProjectPath,
        ...MCP_CONFIG.PROJECT_OPENWAGGLE_CONFIG_DIR,
        MCP_CONFIG.PROJECT_OPENWAGGLE_CONFIG_FILE_NAME,
      ),
      scope: 'project',
      kind: 'openwaggle',
      editable: true,
    },
  )
  return sources
}

function getServers(config: LoadedMcpSource['config']): McpServerMap {
  return config.mcpServers ?? config.servers ?? {}
}

function getIgnoredFields(config: LoadedMcpSource['config'], servers: McpServerMap) {
  const ignored = Object.keys(config).filter((field) => !KNOWN_CONFIG_FIELDS.has(field))
  for (const [name, definition] of Object.entries(servers)) {
    ignored.push(...getIgnoredMcpServerFields(definition).map((field) => `${name}.${field}`))
  }
  return ignored.sort()
}

async function loadMcpSource(definition: McpSourceDefinition): Promise<LoadedMcpSource> {
  const rawJson = await readTextIfPresent(definition.path)
  const parsed = parseMcpConfigFileForView(definition.path, rawJson)
  const servers = getServers(parsed.config)
  return {
    definition,
    exists: rawJson !== null,
    rawJson: rawJson ?? MCP_CONFIG.EMPTY_CONFIG_RAW_JSON,
    config: parsed.config,
    servers,
    ignoredFields: getIgnoredFields(parsed.config, servers),
    parseError: parsed.parseError,
  }
}

export function loadMcpSources(
  options: McpFilesystemConfigServiceOptions,
  projectPath?: string | null,
) {
  return Promise.all(getMcpConfigSources(options, projectPath).map(loadMcpSource))
}

export function getMcpSourceDefinition(
  options: McpFilesystemConfigServiceOptions,
  sourceId: McpConfigSourceId,
  projectPath?: string | null,
) {
  const source = getMcpConfigSources(options, projectPath).find(
    (candidate) => candidate.id === sourceId,
  )
  if (!source) throw new Error(`MCP config source "${sourceId}" is unavailable for this scope.`)
  return source
}
