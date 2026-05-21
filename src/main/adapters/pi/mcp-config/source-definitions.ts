import { createHash } from 'node:crypto'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpConfigSourceId, PiAgentSettingsFile } from '@shared/types/mcp'
import { getActiveServers, getDisabledServers } from './config-accessors'
import {
  parseMcpConfigFileForView,
  parsePiAgentSettingsFileForView,
  readPiAgentSettingsFile,
  readTextIfPresent,
  writeJsonFile,
} from './json-files'
import type { LoadedSource, McpSourceDefinition, PiMcpConfigServiceOptions } from './types'

export function getConfigSources(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
  const sources: McpSourceDefinition[] = [
    {
      id: 'global-standard',
      label: 'Global standard MCP',
      path: path.join(
        options.homeDir,
        ...MCP_CONFIG.GLOBAL_STANDARD_CONFIG_DIR,
        MCP_CONFIG.CONFIG_FILE_NAME,
      ),
      scope: 'global',
      kind: 'standard',
      editable: true,
    },
    {
      id: 'global-pi',
      label: 'Global Pi MCP',
      path: path.join(options.agentDir, MCP_CONFIG.CONFIG_FILE_NAME),
      scope: 'global',
      kind: 'pi',
      editable: true,
    },
  ]

  const normalizedProjectPath = projectPath?.trim()
  if (!normalizedProjectPath) {
    return sources
  }

  sources.push(...getProjectConfigSources(normalizedProjectPath))
  return sources
}

function getProjectConfigSources(projectPath: string): McpSourceDefinition[] {
  return [
    {
      id: 'project-standard',
      label: 'Project standard MCP',
      path: path.join(projectPath, MCP_CONFIG.PROJECT_STANDARD_CONFIG_FILE_NAME),
      scope: 'project',
      kind: 'standard',
      editable: true,
    },
    {
      id: 'project-agents',
      label: 'Project agents MCP',
      path: path.join(
        projectPath,
        MCP_CONFIG.PROJECT_AGENTS_CONFIG_DIR,
        MCP_CONFIG.CONFIG_FILE_NAME,
      ),
      scope: 'project',
      kind: 'agents',
      editable: true,
    },
    {
      id: 'project-pi',
      label: 'Project Pi MCP',
      path: path.join(projectPath, MCP_CONFIG.PROJECT_PI_CONFIG_DIR, MCP_CONFIG.CONFIG_FILE_NAME),
      scope: 'project',
      kind: 'pi',
      editable: true,
    },
    {
      id: 'project-openwaggle',
      label: 'Project OpenWaggle MCP',
      path: path.join(
        projectPath,
        ...MCP_CONFIG.PROJECT_OPENWAGGLE_CONFIG_DIR,
        MCP_CONFIG.CONFIG_FILE_NAME,
      ),
      scope: 'project',
      kind: 'openwaggle',
      editable: true,
    },
  ]
}

async function loadSource(definition: McpSourceDefinition): Promise<LoadedSource> {
  const rawJson = await readTextIfPresent(definition.path)
  const parsed = parseMcpConfigFileForView(definition.path, rawJson)
  return {
    definition,
    exists: rawJson !== null,
    rawJson: rawJson ?? MCP_CONFIG.EMPTY_CONFIG_RAW_JSON,
    config: parsed.config,
    activeServers: getActiveServers(parsed.config),
    disabledServers: getDisabledServers(parsed.config),
    parseError: parsed.parseError,
  }
}

export async function loadSources(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
  return Promise.all(getConfigSources(options, projectPath).map(loadSource))
}
function generatedConfigHash(projectPath?: string | null) {
  const key = projectPath?.trim() || 'global'
  return createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, MCP_CONFIG.CONFIG_HASH_PREFIX_LENGTH)
}

export function getGeneratedConfigPath(
  options: PiMcpConfigServiceOptions,
  projectPath?: string | null,
) {
  return path.join(
    options.agentDir,
    MCP_CONFIG.GENERATED_CONFIG_DIR,
    generatedConfigHash(projectPath),
    MCP_CONFIG.CONFIG_FILE_NAME,
  )
}

export function getGeneratedAdapterCwd(
  options: PiMcpConfigServiceOptions,
  projectPath?: string | null,
) {
  return path.join(
    options.agentDir,
    MCP_CONFIG.GENERATED_CONFIG_DIR,
    generatedConfigHash(projectPath),
    MCP_CONFIG.GENERATED_ADAPTER_CWD_DIR,
  )
}

export async function readGlobalPiSettings(options: PiMcpConfigServiceOptions) {
  return readPiAgentSettingsFile(path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME))
}

export async function readGlobalPiSettingsForView(options: PiMcpConfigServiceOptions) {
  const settingsPath = path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME)
  return parsePiAgentSettingsFileForView(settingsPath, await readTextIfPresent(settingsPath))
}

export async function writeGlobalPiSettings(
  options: PiMcpConfigServiceOptions,
  settings: PiAgentSettingsFile,
) {
  await writeJsonFile(path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME), settings)
}

export function getSourceDefinition(
  options: PiMcpConfigServiceOptions,
  sourceId: McpConfigSourceId,
  projectPath?: string | null,
) {
  const source = getConfigSources(options, projectPath).find(
    (candidate) => candidate.id === sourceId,
  )
  if (!source) {
    throw new Error(`MCP config source "${sourceId}" is not available for this scope`)
  }
  return source
}
