import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { McpConfigCredentialValue } from '@shared/types/mcp'

const MCPB_MANIFEST_LIMIT_BYTES = 1_000_000
const SUPPORTED_MANIFEST_VERSIONS = new Set(['0.3', '0.4'])
const SUPPORTED_SERVER_TYPES = new Set(['node', 'python', 'binary', 'uv'])
const DEFAULT_RUNTIME_COMMANDS: Readonly<Record<string, string>> = {
  node: 'node',
  python: 'python',
  uv: 'uv',
}
const ALLOWED_RUNTIME_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  node: ['node'],
  python: ['python', 'python3'],
  uv: ['uv'],
}

export interface McpbCachedLauncher {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, McpConfigCredentialValue>>
}

interface McpbManifest {
  readonly manifestVersion: string
  readonly server: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonemptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

async function readManifest(root: string): Promise<McpbManifest> {
  const manifestPath = path.join(root, 'manifest.json')
  const metadata = await lstat(manifestPath)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MCPB_MANIFEST_LIMIT_BYTES
  ) {
    throw new Error('MCPB manifest.json is not a bounded regular file.')
  }
  let value: unknown
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    throw new Error('MCPB manifest.json is not valid JSON.')
  }
  if (!isRecord(value)) throw new Error('MCPB manifest.json must be an object.')
  const manifestVersion = nonemptyString(value.manifest_version)
  const version = nonemptyString(value.version)
  const author = isRecord(value.author) ? value.author : undefined
  const server = isRecord(value.server) ? value.server : undefined
  const requiredFields = [
    manifestVersion && SUPPORTED_MANIFEST_VERSIONS.has(manifestVersion),
    nonemptyString(value.name),
    version,
    nonemptyString(value.description),
    nonemptyString(author?.name),
    server,
  ]
  if (requiredFields.some((field) => !field) || !manifestVersion || !version || !server) {
    throw new Error('MCPB manifest is missing required current manifest fields.')
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('MCPB manifest version must be an exact semantic version.')
  }
  return { manifestVersion, server, raw: value }
}

function serverLaunchDetails(manifest: McpbManifest, platform: NodeJS.Platform) {
  const type = nonemptyString(manifest.server.type)
  const declaredEntryPoint = nonemptyString(manifest.server.entry_point)
  if (!type || !declaredEntryPoint || !SUPPORTED_SERVER_TYPES.has(type)) {
    throw new Error('MCPB server requires a supported type and entry_point.')
  }
  if (type === 'uv' && manifest.manifestVersion !== '0.4') {
    throw new Error('MCPB uv servers require manifest_version 0.4.')
  }
  const entryPoint =
    type === 'binary' && platform === 'win32' && !declaredEntryPoint.endsWith('.exe')
      ? `${declaredEntryPoint}.exe`
      : declaredEntryPoint
  return { type, entryPoint }
}

async function resolveRuntimeCommand(input: {
  readonly root: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly type: string
  readonly entryPoint: string
  readonly configuredCommand?: string
}) {
  const defaultCommand = DEFAULT_RUNTIME_COMMANDS[input.type] ?? input.entryPoint
  const substituted = substituteManifestValue(
    input.configuredCommand ?? defaultCommand,
    input.root,
    input.homeDir,
  )
  if (input.type !== 'binary') {
    const allowed = ALLOWED_RUNTIME_COMMANDS[input.type] ?? []
    if (!allowed.includes(substituted)) {
      throw new Error(`MCPB ${input.type} package requested an unsupported runtime command.`)
    }
    return substituted
  }

  const relativeCommand = path.isAbsolute(substituted)
    ? path.relative(input.root, substituted)
    : substituted
  const windowsCommand =
    input.platform === 'win32' && !relativeCommand.endsWith('.exe')
      ? `${relativeCommand}.exe`
      : relativeCommand
  const command = safeBundlePath(input.root, windowsCommand)
  await assertCachedRegularFile(input.root, command)
  return command
}

function defaultLauncherArgs(type: string, root: string, entryPointPath: string) {
  if (type === 'uv') return ['run', '--directory', root, entryPointPath]
  return type === 'binary' ? [] : [entryPointPath]
}

function assertPlatformCompatibility(manifest: McpbManifest, platform: NodeJS.Platform) {
  const compatibility = isRecord(manifest.raw.compatibility)
    ? manifest.raw.compatibility
    : undefined
  if (compatibility?.platforms === undefined) return
  if (
    !Array.isArray(compatibility.platforms) ||
    compatibility.platforms.some((candidate) => typeof candidate !== 'string')
  ) {
    throw new Error('MCPB compatibility.platforms must be an array of platform names.')
  }
  if (!compatibility.platforms.includes(platform)) {
    throw new Error(`MCPB package does not support the ${platform} platform.`)
  }
}

function safeBundlePath(root: string, relativePath: string) {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(
      `MCPB manifest contains an unsafe bundle path: ${JSON.stringify(relativePath)}.`,
    )
  }
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `MCPB manifest contains an unsafe bundle path: ${JSON.stringify(relativePath)}.`,
    )
  }
  return resolved
}

async function assertCachedRegularFile(root: string, target: string) {
  const metadata = await lstat(target)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`MCPB entry point is not a regular file: ${target}.`)
  }
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('MCPB entry point resolves outside the verified package cache.')
  }
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== 'string')) {
    throw new Error(`MCPB ${field} must be an array of strings.`)
  }
  return value.filter((candidate): candidate is string => typeof candidate === 'string')
}

function stringMap(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.values(value).some((candidate) => typeof candidate !== 'string')) {
    throw new Error(`MCPB ${field} must contain only string values.`)
  }
  const result: Record<string, string> = {}
  for (const [name, candidate] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`MCPB ${field} contains an invalid environment variable name.`)
    }
    if (typeof candidate === 'string') result[name] = candidate
  }
  return result
}

function substituteManifestValue(value: string, root: string, homeDir: string) {
  const replacements: Readonly<Record<string, string>> = {
    __dirname: root,
    HOME: homeDir,
    DESKTOP: path.join(homeDir, 'Desktop'),
    DOCUMENTS: path.join(homeDir, 'Documents'),
    DOWNLOADS: path.join(homeDir, 'Downloads'),
    pathSeparator: path.sep,
    '/': path.sep,
  }
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const replacement = replacements[name]
    if (replacement === undefined) {
      throw new Error(
        `MCPB requires unresolved configuration ${JSON.stringify(name)}; configure it before adding the server.`,
      )
    }
    return replacement
  })
}

function resolvedMcpConfig(manifest: McpbManifest, platform: NodeJS.Platform) {
  const base = isRecord(manifest.server.mcp_config) ? manifest.server.mcp_config : {}
  const overrides = isRecord(base.platform_overrides) ? base.platform_overrides : {}
  const override = isRecord(overrides[platform]) ? overrides[platform] : {}
  return {
    command: nonemptyString(override.command) ?? nonemptyString(base.command),
    args: stringArray(override.args, 'platform args') ?? stringArray(base.args, 'args'),
    env: {
      ...stringMap(base.env, 'environment'),
      ...stringMap(override.env, 'platform environment'),
    },
  }
}

export async function loadMcpbLauncher(input: {
  readonly root: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
}): Promise<McpbCachedLauncher> {
  const manifest = await readManifest(input.root)
  assertPlatformCompatibility(manifest, input.platform)
  const { type, entryPoint } = serverLaunchDetails(manifest, input.platform)
  const entryPointPath = safeBundlePath(input.root, entryPoint)
  await assertCachedRegularFile(input.root, entryPointPath)
  if (type === 'uv') {
    await assertCachedRegularFile(input.root, path.join(input.root, 'pyproject.toml'))
  }

  const config = resolvedMcpConfig(manifest, input.platform)
  const command = await resolveRuntimeCommand({
    root: input.root,
    homeDir: input.homeDir,
    platform: input.platform,
    type,
    entryPoint,
    ...(config.command ? { configuredCommand: config.command } : {}),
  })
  const args = (config.args ?? defaultLauncherArgs(type, input.root, entryPointPath)).map((value) =>
    substituteManifestValue(value, input.root, input.homeDir),
  )
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.env)) {
    env[name] = substituteManifestValue(value, input.root, input.homeDir)
  }
  return { command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
}
