import { mkdir } from 'node:fs/promises'
import type { McpSetServerEnabledInput, McpWriteSourceConfigInput } from '@shared/types/mcp'
import {
  addAdapterPackageSource,
  getActiveServers,
  getDisabledServers,
  isAdapterEnabled,
  removeAdapterPackageSource,
  setActiveServers,
  setDisabledServers,
} from './config-accessors'
import { MCP_ADAPTER_PACKAGE_SOURCE } from './constants'
import {
  assertNoInvalidMcpSources,
  buildEffectiveConfig,
  buildRuntimeConfigObject,
  buildServerSummaries,
  buildSourceSummary,
} from './effective-config'
import { parseMcpConfigFile, readMcpConfigFile, writeJsonFile } from './json-files'
import {
  getGeneratedAdapterCwd,
  getGeneratedConfigPath,
  getSourceDefinition,
  loadSources,
  readGlobalPiSettings,
  readGlobalPiSettingsForView,
  writeGlobalPiSettings,
} from './source-definitions'
import type { PiMcpConfigServiceForTests, PiMcpConfigServiceOptions } from './types'

async function getMcpView(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
  const sources = await loadSources(options, projectPath)
  const effective = buildEffectiveConfig(sources)
  const globalSettings = await readGlobalPiSettingsForView(options)
  const runtimeConfigPath = getGeneratedConfigPath(options, projectPath)

  return {
    adapter: {
      enabled: isAdapterEnabled(globalSettings.settings),
      packageSource: MCP_ADAPTER_PACKAGE_SOURCE,
      runtimeConfigPath,
      ...(globalSettings.parseError ? { lastError: globalSettings.parseError } : {}),
    },
    sources: sources.map(buildSourceSummary),
    effective,
    servers: buildServerSummaries(sources),
    runtimeConfigPath,
  }
}

async function setAdapterEnabled(
  options: PiMcpConfigServiceOptions,
  enabled: boolean,
  projectPath?: string | null,
) {
  const currentSettings = await readGlobalPiSettings(options)
  const nextSettings = enabled
    ? addAdapterPackageSource(currentSettings)
    : removeAdapterPackageSource(currentSettings)

  if (enabled) {
    await options.installAdapterPackage(MCP_ADAPTER_PACKAGE_SOURCE, projectPath)
  }

  await writeGlobalPiSettings(options, nextSettings)
  return getMcpView(options, projectPath)
}

async function setServerEnabled(
  options: PiMcpConfigServiceOptions,
  input: McpSetServerEnabledInput,
) {
  const definition = getSourceDefinition(options, input.sourceId, input.projectPath)
  const config = await readMcpConfigFile(definition.path)
  const activeServers = getActiveServers(config)
  const disabledServers = getDisabledServers(config)
  const entry = activeServers[input.serverName] ?? disabledServers[input.serverName]

  if (!entry) {
    throw new Error(`MCP server "${input.serverName}" was not found in ${definition.label}`)
  }

  if (input.enabled) {
    activeServers[input.serverName] = entry
    delete disabledServers[input.serverName]
  } else {
    disabledServers[input.serverName] = entry
    delete activeServers[input.serverName]
  }

  setActiveServers(config, activeServers)
  setDisabledServers(config, disabledServers)
  await writeJsonFile(definition.path, config)
  return getMcpView(options, input.projectPath)
}
async function writeSourceConfig(
  options: PiMcpConfigServiceOptions,
  input: McpWriteSourceConfigInput,
) {
  const definition = getSourceDefinition(options, input.sourceId, input.projectPath)
  const nextConfig = parseMcpConfigFile(input.rawJson)
  await writeJsonFile(definition.path, nextConfig)
  return getMcpView(options, input.projectPath)
}

async function prepareEffectiveConfig(
  options: PiMcpConfigServiceOptions,
  projectPath?: string | null,
) {
  const sources = await loadSources(options, projectPath)
  assertNoInvalidMcpSources(sources)
  const effective = buildEffectiveConfig(sources)
  const targetPath = getGeneratedConfigPath(options, projectPath)
  await writeJsonFile(targetPath, buildRuntimeConfigObject(effective))
  return targetPath
}

async function prepareRuntimeContext(
  options: PiMcpConfigServiceOptions,
  projectPath?: string | null,
) {
  const view = await getMcpView(options, projectPath)
  if (view.adapter.lastError) {
    throw new Error(view.adapter.lastError)
  }
  if (!view.adapter.enabled) {
    return null
  }

  await options.installAdapterPackage(MCP_ADAPTER_PACKAGE_SOURCE, projectPath)
  await writeGlobalPiSettings(options, addAdapterPackageSource(await readGlobalPiSettings(options)))

  const configPath = await prepareEffectiveConfig(options, projectPath)
  if (!configPath) {
    return null
  }

  const adapterCwd = getGeneratedAdapterCwd(options, projectPath)
  await mkdir(adapterCwd, { recursive: true })
  return { configPath, adapterCwd }
}

export function createPiMcpConfigService(
  options: PiMcpConfigServiceOptions,
): PiMcpConfigServiceForTests {
  return {
    getView: (projectPath) => getMcpView(options, projectPath),
    setAdapterEnabled: (enabled, projectPath) => setAdapterEnabled(options, enabled, projectPath),
    setServerEnabled: (input) => setServerEnabled(options, input),
    writeSourceConfig: (input) => writeSourceConfig(options, input),
    prepareEffectiveConfig: (projectPath) => prepareEffectiveConfig(options, projectPath),
    prepareRuntimeContext: (projectPath) => prepareRuntimeContext(options, projectPath),
  }
}

export function createPiMcpConfigServiceForTests(options: {
  readonly homeDir: string
  readonly agentDir: string
  readonly installAdapterPackage?: (source: string, projectPath?: string | null) => Promise<void>
}): PiMcpConfigServiceForTests {
  return createPiMcpConfigService({
    homeDir: options.homeDir,
    agentDir: options.agentDir,
    installAdapterPackage: options.installAdapterPackage ?? (() => Promise.resolve()),
  })
}
