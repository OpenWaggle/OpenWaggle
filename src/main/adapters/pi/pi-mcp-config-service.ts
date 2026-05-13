import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  type AgentSessionServices,
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import {
  MCP_ADAPTER_PACKAGE_SOURCE,
  MCP_ADAPTER_PACKAGE_SOURCES,
  MCP_CONFIG,
} from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigFileSchema, piAgentSettingsFileSchema } from '@shared/schemas/mcp'
import type {
  McpAdapterSettings,
  McpConfigFile,
  McpConfigSourceId,
  McpConfigSourceKind,
  McpConfigSourceScope,
  McpConfigSourceSummary,
  McpDirectToolsMode,
  McpEffectiveConfig,
  McpOpenWaggleConfig,
  McpPackageEntry,
  McpServerMap,
  McpServerSummary,
  McpServerTransport,
  McpSetServerEnabledInput,
  McpSettingsView,
  McpWriteSourceConfigInput,
  PiAgentSettingsFile,
} from '@shared/types/mcp'
import { Effect, Layer } from 'effect'
import { getNpmCompatiblePath, withTemporaryProcessEnv } from '../../env'
import { createLogger } from '../../logger'
import { McpConfigService } from '../../ports/mcp-config-service'

const logger = createLogger('pi-mcp-config')

interface McpSourceDefinition {
  readonly id: McpConfigSourceId
  readonly label: string
  readonly path: string
  readonly scope: McpConfigSourceScope
  readonly kind: McpConfigSourceKind
  readonly editable: boolean
}

interface LoadedSource {
  readonly definition: McpSourceDefinition
  readonly exists: boolean
  readonly rawJson: string
  readonly config: McpConfigFile
  readonly activeServers: McpServerMap
  readonly disabledServers: McpServerMap
  readonly parseError: string | null
}

interface ParsedMcpConfigFile {
  readonly config: McpConfigFile
  readonly parseError: string | null
}

interface ParsedPiAgentSettingsFile {
  readonly settings: PiAgentSettingsFile
  readonly parseError: string | null
}

interface PiMcpConfigServiceOptions {
  readonly homeDir: string
  readonly agentDir: string
  readonly installAdapterPackage: (source: string, projectPath?: string | null) => Promise<void>
}

export interface OpenWaggleMcpRuntimeContext {
  readonly configPath: string
  readonly adapterCwd: string
}

export interface PiMcpConfigServiceForTests {
  readonly getView: (projectPath?: string | null) => Promise<McpSettingsView>
  readonly setAdapterEnabled: (
    enabled: boolean,
    projectPath?: string | null,
  ) => Promise<McpSettingsView>
  readonly setServerEnabled: (input: McpSetServerEnabledInput) => Promise<McpSettingsView>
  readonly writeSourceConfig: (input: McpWriteSourceConfigInput) => Promise<McpSettingsView>
  readonly prepareEffectiveConfig: (projectPath?: string | null) => Promise<string | null>
  readonly prepareRuntimeContext: (
    projectPath?: string | null,
  ) => Promise<OpenWaggleMcpRuntimeContext | null>
}

const mcpRuntimeContextsByServices = new WeakMap<
  AgentSessionServices,
  OpenWaggleMcpRuntimeContext
>()
let mcpAdapterProcessContextQueue: Promise<void> = Promise.resolve()
const MCP_ADAPTER_PACKAGE_SOURCE_SET = new Set<string>(MCP_ADAPTER_PACKAGE_SOURCES)

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ENOENT'
  )
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}

function parseMcpConfigFile(rawJson: string | null): McpConfigFile {
  if (!rawJson || rawJson.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(mcpConfigFileSchema, parsed)
}

function parsePiAgentSettingsFile(rawJson: string | null): PiAgentSettingsFile {
  if (!rawJson || rawJson.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(piAgentSettingsFileSchema, parsed)
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createConfigReadError(label: string, filePath: string, error: unknown): Error {
  return new Error(`${label} at ${filePath}: ${formatErrorMessage(error)}`)
}

function parseMcpConfigFileForView(filePath: string, rawJson: string | null): ParsedMcpConfigFile {
  try {
    return {
      config: parseMcpConfigFile(rawJson),
      parseError: null,
    }
  } catch (error) {
    const message = createConfigReadError('Invalid MCP JSON config', filePath, error).message
    logger.warn('Invalid MCP JSON config', {
      path: filePath,
      error: formatErrorMessage(error),
    })
    return {
      config: {},
      parseError: message,
    }
  }
}

function parsePiAgentSettingsFileForView(
  filePath: string,
  rawJson: string | null,
): ParsedPiAgentSettingsFile {
  try {
    return {
      settings: parsePiAgentSettingsFile(rawJson),
      parseError: null,
    }
  } catch (error) {
    const message = createConfigReadError('Invalid Pi settings JSON', filePath, error).message
    logger.warn('Invalid Pi settings JSON', {
      path: filePath,
      error: formatErrorMessage(error),
    })
    return {
      settings: {},
      parseError: message,
    }
  }
}

async function readMcpConfigFile(filePath: string): Promise<McpConfigFile> {
  try {
    return parseMcpConfigFile(await readTextIfPresent(filePath))
  } catch (error) {
    logger.warn('Invalid MCP JSON config', {
      path: filePath,
      error: formatErrorMessage(error),
    })
    throw createConfigReadError('Invalid MCP JSON config', filePath, error)
  }
}

async function readPiAgentSettingsFile(filePath: string): Promise<PiAgentSettingsFile> {
  try {
    return parsePiAgentSettingsFile(await readTextIfPresent(filePath))
  } catch (error) {
    logger.warn('Invalid Pi settings JSON', {
      path: filePath,
      error: formatErrorMessage(error),
    })
    throw createConfigReadError('Invalid Pi settings JSON', filePath, error)
  }
}

async function writeJsonFile(
  filePath: string,
  value: McpConfigFile | PiAgentSettingsFile,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
      'utf-8',
    )
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function getActiveServers(config: McpConfigFile): McpServerMap {
  return config.mcpServers ?? config['mcp-servers'] ?? {}
}

function getOpenWaggleConfig(config: McpConfigFile): McpOpenWaggleConfig {
  return config.openwaggle ?? {}
}

function getDisabledServers(config: McpConfigFile): McpServerMap {
  return getOpenWaggleConfig(config).disabledMcpServers ?? {}
}

function getSettings(config: McpConfigFile): McpAdapterSettings {
  return config.settings ?? {}
}

function getImports(config: McpConfigFile): readonly string[] {
  return config.imports ?? []
}

function setActiveServers(config: McpConfigFile, servers: McpServerMap): void {
  delete config['mcp-servers']
  config.mcpServers = servers
}

function setDisabledServers(config: McpConfigFile, servers: McpServerMap): void {
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

function getPackageSource(value: McpPackageEntry): string {
  if (typeof value === 'string') {
    return value
  }
  return value.source
}

function getPackageEntries(settings: PiAgentSettingsFile): McpPackageEntry[] {
  return settings.packages ?? []
}

function packageSourceMatches(value: McpPackageEntry): boolean {
  return MCP_ADAPTER_PACKAGE_SOURCE_SET.has(getPackageSource(value))
}

function isAdapterEnabled(settings: PiAgentSettingsFile): boolean {
  return getPackageEntries(settings).some(packageSourceMatches)
}

function addAdapterPackageSource(settings: PiAgentSettingsFile): PiAgentSettingsFile {
  const packages = [
    ...getPackageEntries(settings).filter((entry) => !packageSourceMatches(entry)),
    MCP_ADAPTER_PACKAGE_SOURCE,
  ]
  return {
    ...settings,
    packages,
  }
}

function removeAdapterPackageSource(settings: PiAgentSettingsFile): PiAgentSettingsFile {
  return {
    ...settings,
    packages: getPackageEntries(settings).filter((entry) => !packageSourceMatches(entry)),
  }
}

function mergeSettings(base: McpAdapterSettings, next: McpAdapterSettings): McpAdapterSettings {
  return {
    ...base,
    ...next,
  }
}

function mergeImports(base: readonly string[], next: readonly string[]): readonly string[] {
  return [...new Set([...base, ...next])]
}

function getServerTransport(entry: McpServerMap[string]): McpServerTransport {
  if (typeof entry.url === 'string') {
    return 'http'
  }
  if (typeof entry.command === 'string') {
    return 'stdio'
  }
  return 'unknown'
}

function getDirectToolsMode(entry: McpServerMap[string]): McpDirectToolsMode {
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

function getConfigSources(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
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

  sources.push(
    {
      id: 'project-standard',
      label: 'Project standard MCP',
      path: path.join(normalizedProjectPath, MCP_CONFIG.PROJECT_STANDARD_CONFIG_FILE_NAME),
      scope: 'project',
      kind: 'standard',
      editable: true,
    },
    {
      id: 'project-agents',
      label: 'Project agents MCP',
      path: path.join(
        normalizedProjectPath,
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
      path: path.join(
        normalizedProjectPath,
        MCP_CONFIG.PROJECT_PI_CONFIG_DIR,
        MCP_CONFIG.CONFIG_FILE_NAME,
      ),
      scope: 'project',
      kind: 'pi',
      editable: true,
    },
    {
      id: 'project-openwaggle',
      label: 'Project OpenWaggle MCP',
      path: path.join(
        normalizedProjectPath,
        ...MCP_CONFIG.PROJECT_OPENWAGGLE_CONFIG_DIR,
        MCP_CONFIG.CONFIG_FILE_NAME,
      ),
      scope: 'project',
      kind: 'openwaggle',
      editable: true,
    },
  )

  return sources
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

async function loadSources(
  options: PiMcpConfigServiceOptions,
  projectPath?: string | null,
): Promise<readonly LoadedSource[]> {
  return Promise.all(getConfigSources(options, projectPath).map(loadSource))
}

function buildEffectiveConfig(sources: readonly LoadedSource[]): McpEffectiveConfig {
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

function buildSourceSummary(source: LoadedSource): McpConfigSourceSummary {
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

function buildServerSummaries(sources: readonly LoadedSource[]): readonly McpServerSummary[] {
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

function getGeneratedConfigPath(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
  const key = projectPath?.trim() || 'global'
  const hash = createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, MCP_CONFIG.CONFIG_HASH_PREFIX_LENGTH)
  return path.join(
    options.agentDir,
    MCP_CONFIG.GENERATED_CONFIG_DIR,
    hash,
    MCP_CONFIG.CONFIG_FILE_NAME,
  )
}

function getGeneratedAdapterCwd(options: PiMcpConfigServiceOptions, projectPath?: string | null) {
  const key = projectPath?.trim() || 'global'
  const hash = createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, MCP_CONFIG.CONFIG_HASH_PREFIX_LENGTH)
  return path.join(
    options.agentDir,
    MCP_CONFIG.GENERATED_CONFIG_DIR,
    hash,
    MCP_CONFIG.GENERATED_ADAPTER_CWD_DIR,
  )
}

async function readGlobalPiSettings(
  options: PiMcpConfigServiceOptions,
): Promise<PiAgentSettingsFile> {
  return readPiAgentSettingsFile(path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME))
}

async function readGlobalPiSettingsForView(
  options: PiMcpConfigServiceOptions,
): Promise<ParsedPiAgentSettingsFile> {
  const settingsPath = path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME)
  return parsePiAgentSettingsFileForView(settingsPath, await readTextIfPresent(settingsPath))
}

async function writeGlobalPiSettings(
  options: PiMcpConfigServiceOptions,
  settings: PiAgentSettingsFile,
): Promise<void> {
  await writeJsonFile(path.join(options.agentDir, MCP_CONFIG.SETTINGS_FILE_NAME), settings)
}

function getSourceDefinition(
  options: PiMcpConfigServiceOptions,
  sourceId: McpConfigSourceId,
  projectPath?: string | null,
): McpSourceDefinition {
  const source = getConfigSources(options, projectPath).find(
    (candidate) => candidate.id === sourceId,
  )
  if (!source) {
    throw new Error(`MCP config source "${sourceId}" is not available for this scope`)
  }
  return source
}

function buildRuntimeConfigObject(effective: McpEffectiveConfig): McpConfigFile {
  return {
    ...(effective.imports.length > 0 ? { imports: [...effective.imports] } : {}),
    ...(Object.keys(effective.settings).length > 0 ? { settings: effective.settings } : {}),
    mcpServers: effective.mcpServers,
  }
}

function assertNoInvalidMcpSources(sources: readonly LoadedSource[]): void {
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

export function createPiMcpConfigService(
  options: PiMcpConfigServiceOptions,
): PiMcpConfigServiceForTests {
  async function getView(projectPath?: string | null): Promise<McpSettingsView> {
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
    enabled: boolean,
    projectPath?: string | null,
  ): Promise<McpSettingsView> {
    const currentSettings = await readGlobalPiSettings(options)
    const wasEnabled = isAdapterEnabled(currentSettings)
    const nextSettings = enabled
      ? addAdapterPackageSource(currentSettings)
      : removeAdapterPackageSource(currentSettings)

    if (enabled && !wasEnabled) {
      await options.installAdapterPackage(MCP_ADAPTER_PACKAGE_SOURCE, projectPath)
    }

    await writeGlobalPiSettings(options, nextSettings)

    return getView(projectPath)
  }

  async function setServerEnabled(input: McpSetServerEnabledInput): Promise<McpSettingsView> {
    const definition = getSourceDefinition(options, input.sourceId, input.projectPath)
    const config = await readMcpConfigFile(definition.path)
    const activeServers = getActiveServers(config)
    const disabledServers = getDisabledServers(config)
    const activeEntry = activeServers[input.serverName]
    const disabledEntry = disabledServers[input.serverName]
    const entry = activeEntry ?? disabledEntry

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
    return getView(input.projectPath)
  }

  async function writeSourceConfig(input: McpWriteSourceConfigInput): Promise<McpSettingsView> {
    const definition = getSourceDefinition(options, input.sourceId, input.projectPath)
    const nextConfig = parseMcpConfigFile(input.rawJson)
    await writeJsonFile(definition.path, nextConfig)
    return getView(input.projectPath)
  }

  async function prepareEffectiveConfig(projectPath?: string | null): Promise<string | null> {
    const sources = await loadSources(options, projectPath)
    assertNoInvalidMcpSources(sources)
    const effective = buildEffectiveConfig(sources)
    const targetPath = getGeneratedConfigPath(options, projectPath)
    await writeJsonFile(targetPath, buildRuntimeConfigObject(effective))
    return targetPath
  }

  async function prepareRuntimeContext(
    projectPath?: string | null,
  ): Promise<OpenWaggleMcpRuntimeContext | null> {
    const configPath = await prepareEffectiveConfig(projectPath)
    if (!configPath) {
      return null
    }

    const adapterCwd = getGeneratedAdapterCwd(options, projectPath)
    await mkdir(adapterCwd, { recursive: true })
    return { configPath, adapterCwd }
  }

  return {
    getView,
    setAdapterEnabled,
    setServerEnabled,
    writeSourceConfig,
    prepareEffectiveConfig,
    prepareRuntimeContext,
  }
}

async function installMcpAdapterPackage(
  source: string,
  projectPath?: string | null,
): Promise<void> {
  const agentDir = getAgentDir()
  const cwd = projectPath?.trim() || agentDir
  const npmCacheDir = path.join(agentDir, MCP_CONFIG.NPM_CACHE_DIR)
  await mkdir(agentDir, { recursive: true })
  await mkdir(npmCacheDir, { recursive: true })

  await withTemporaryProcessEnv(
    {
      PATH: getNpmCompatiblePath(),
      npm_config_cache: npmCacheDir,
      NPM_CONFIG_CACHE: npmCacheDir,
    },
    async () => {
      const settingsManager = SettingsManager.create(cwd, agentDir)
      const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
      await packageManager.install(source, { local: false })
    },
  )
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

export async function prepareOpenWaggleMcpRuntimeContext(
  projectPath: string,
): Promise<OpenWaggleMcpRuntimeContext | null> {
  const service = createPiMcpConfigService({
    homeDir: homedir(),
    agentDir: getAgentDir(),
    installAdapterPackage: installMcpAdapterPackage,
  })
  const view = await service.getView(projectPath)
  if (view.adapter.lastError) {
    throw new Error(view.adapter.lastError)
  }
  if (!view.adapter.enabled) {
    return null
  }
  return service.prepareRuntimeContext(projectPath)
}

function withMcpConfigArgv(argv: readonly string[], configPath: string): readonly string[] {
  const nextArgv: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === MCP_CONFIG.ARG_CONFIG_FLAG) {
      index += 1
      continue
    }
    nextArgv.push(argv[index] ?? '')
  }
  nextArgv.push(MCP_CONFIG.ARG_CONFIG_FLAG, configPath)
  return nextArgv
}

async function acquireMcpAdapterProcessContextLock(): Promise<() => void> {
  const previous = mcpAdapterProcessContextQueue
  let releaseCurrent: (() => void) | undefined
  mcpAdapterProcessContextQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  await previous
  return () => releaseCurrent?.()
}

export async function withOpenWaggleMcpAdapterProcessContext<T>(
  context: OpenWaggleMcpRuntimeContext | null,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireMcpAdapterProcessContextLock()
  if (!context) {
    try {
      return await operation()
    } finally {
      release()
    }
  }

  const previousCwd = process.cwd
  const previousArgv = [...process.argv]
  process.cwd = () => context.adapterCwd
  process.argv.splice(
    0,
    process.argv.length,
    ...withMcpConfigArgv(previousArgv, context.configPath),
  )
  try {
    return await operation()
  } finally {
    process.cwd = previousCwd
    process.argv.splice(0, process.argv.length, ...previousArgv)
    release()
  }
}

export function rememberOpenWaggleMcpRuntimeContext(
  services: AgentSessionServices,
  context: OpenWaggleMcpRuntimeContext | null,
): void {
  if (context) {
    mcpRuntimeContextsByServices.set(services, context)
  }
}

export function getOpenWaggleMcpRuntimeContextForServices(
  services: AgentSessionServices,
): OpenWaggleMcpRuntimeContext | null {
  return mcpRuntimeContextsByServices.get(services) ?? null
}

export const PiMcpConfigServiceLive = Layer.succeed(McpConfigService, {
  getView: (projectPath) =>
    Effect.promise(() =>
      createPiMcpConfigService({
        homeDir: homedir(),
        agentDir: getAgentDir(),
        installAdapterPackage: installMcpAdapterPackage,
      }).getView(projectPath),
    ),
  setAdapterEnabled: (input) =>
    Effect.promise(() =>
      createPiMcpConfigService({
        homeDir: homedir(),
        agentDir: getAgentDir(),
        installAdapterPackage: installMcpAdapterPackage,
      }).setAdapterEnabled(input.enabled, input.projectPath),
    ),
  setServerEnabled: (input) =>
    Effect.promise(() =>
      createPiMcpConfigService({
        homeDir: homedir(),
        agentDir: getAgentDir(),
        installAdapterPackage: installMcpAdapterPackage,
      }).setServerEnabled(input),
    ),
  writeSourceConfig: (input) =>
    Effect.promise(() =>
      createPiMcpConfigService({
        homeDir: homedir(),
        agentDir: getAgentDir(),
        installAdapterPackage: installMcpAdapterPackage,
      }).writeSourceConfig(input),
    ),
})
