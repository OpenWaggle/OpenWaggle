import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpCompatibilityProfile,
  McpConfigCredentialValue,
  McpServerDefinition,
  McpServerSummary,
  McpServerTransport,
  McpSettingsView,
} from '@shared/types/mcp'
import { ALL_IMPORT_SOURCES } from './adapters/mcp/import-adapters'
import { parseMcpConfigFile } from './adapters/mcp/json-files'
import { validateMcpCliPositionals } from './mcp-cli-positional-contract'

export { requireServeScope } from './mcp-cli-serve-scope'

const MAX_STDIN_SECRET_BYTES = 1_000_000
const SECRET_ARGUMENT_PATTERN =
  /(api[-_]?key|token|secret|password|credential|authorization|cookie)/i
const [NEXT_ARGUMENT_OFFSET, OPTION_AND_VALUE_COUNT] = [1, 2] as const

export interface ParsedArguments {
  readonly positionals: readonly string[]
  readonly passthrough: readonly string[]
  readonly options: ReadonlyMap<string, readonly string[]>
}

const BOOLEAN_OPTIONS = new Set([
  'all',
  'allow-unsandboxed',
  'apply',
  'approve',
  'credential-stdin',
  'credential-store',
  'dry-run',
  'archived',
  'full',
  'full-transcript',
  'include-archived',
  'include-bodies',
  'include-queue-bodies',
  'json',
  'jsonl',
  'oauth',
  'replace',
  'request-reply',
  'require-fresh',
  'secret-stdin',
  'stdio',
  'stdin',
  'token-stdin',
  'start-from-origin',
  'upstream',
  'queen',
  'yes',
  'yolo',
])

const MANAGEMENT_COMMON_OPTIONS = ['json', 'project'] as const
const MANAGEMENT_COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  add: [
    ...MANAGEMENT_COMMON_OPTIONS,
    'compatibility',
    'env',
    'env-ref',
    'header-ref',
    'oauth',
    'oauth-domain',
    'oauth-scope',
    'protocol',
    'replace',
    'scope',
    'transport',
    'url',
  ],
  auth: [...MANAGEMENT_COMMON_OPTIONS, 'secret', 'secret-stdin'],
  disable: MANAGEMENT_COMMON_OPTIONS,
  doctor: MANAGEMENT_COMMON_OPTIONS,
  enable: MANAGEMENT_COMMON_OPTIONS,
  get: MANAGEMENT_COMMON_OPTIONS,
  help: ['json'],
  import: [...MANAGEMENT_COMMON_OPTIONS, 'apply', 'conflict', 'from', 'scope'],
  list: MANAGEMENT_COMMON_OPTIONS,
  logout: MANAGEMENT_COMMON_OPTIONS,
  registry: [...MANAGEMENT_COMMON_OPTIONS, 'name', 'package', 'registry', 'scope', 'version'],
  remove: MANAGEMENT_COMMON_OPTIONS,
  trust: [...MANAGEMENT_COMMON_OPTIONS, 'allow-unsandboxed'],
}
const SERVE_OPTIONS = [
  'grant',
  'export-root',
  'attachment-root',
  'http',
  'origin-session',
  'profile',
  'session',
  'stdio',
  'token-stdin',
  'workspace',
] as const

function parseOption(args: readonly string[], index: number, options: Map<string, string[]>) {
  const value = args[index] ?? ''
  const separator = value.indexOf('=')
  const key = value.slice(OPTION_AND_VALUE_COUNT, separator > 0 ? separator : undefined)
  const inlineValue = separator > 0 ? value.slice(separator + NEXT_ARGUMENT_OFFSET) : undefined
  const next = args[index + NEXT_ARGUMENT_OFFSET]
  const consumesNext =
    inlineValue === undefined &&
    !BOOLEAN_OPTIONS.has(key) &&
    Boolean(next) &&
    !next?.startsWith('--')
  const optionValue = inlineValue ?? (consumesNext ? (next ?? '') : 'true')
  options.set(key, [...(options.get(key) ?? []), optionValue])
  return consumesNext ? OPTION_AND_VALUE_COUNT : NEXT_ARGUMENT_OFFSET
}

export function parseMcpCliArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = []
  const passthrough: string[] = []
  const options = new Map<string, string[]>()
  let index = 0
  while (index < args.length) {
    const value = args[index]
    if (value === '--') {
      passthrough.push(...args.slice(index + NEXT_ARGUMENT_OFFSET))
      break
    }
    if (!value?.startsWith('--')) {
      if (value !== undefined) positionals.push(value)
      index += NEXT_ARGUMENT_OFFSET
      continue
    }
    index += parseOption(args, index, options)
  }
  return { positionals, passthrough, options }
}

export function option(arguments_: ParsedArguments, name: string) {
  return arguments_.options.get(name)?.at(-1)
}

export function hasFlag(arguments_: ParsedArguments, name: string) {
  return option(arguments_, name) === 'true'
}

export function validateMcpCliOptions(command: string, arguments_: ParsedArguments) {
  validateMcpCliPositionals(command, arguments_)
  const allowed = command === 'serve' ? SERVE_OPTIONS : MANAGEMENT_COMMAND_OPTIONS[command]
  if (!allowed) throw new Error(`Unsupported MCP command: ${command}.`)
  const allowedSet = new Set<string>(allowed)
  const unknown = [...arguments_.options.keys()].filter((name) => !allowedSet.has(name)).sort()
  if (unknown.length > 0) {
    throw new Error(
      `Unknown option${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `--${name}`).join(', ')}.`,
    )
  }
  const missingValues = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      !BOOLEAN_OPTIONS.has(name) && values.some((value) => value === 'true') ? [name] : [],
    )
    .sort()
  if (missingValues.length > 0) {
    throw new Error(`Missing value for ${missingValues.map((name) => `--${name}`).join(', ')}.`)
  }
  const valuedBooleans = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      BOOLEAN_OPTIONS.has(name) && values.some((value) => value !== 'true') ? [name] : [],
    )
    .sort()
  if (valuedBooleans.length > 0) {
    throw new Error(`${valuedBooleans.map((name) => `--${name}`).join(', ')} do not accept values.`)
  }
  if (arguments_.options.has('scope')) target(arguments_)
  if (arguments_.options.has('transport')) transport(option(arguments_, 'transport'))
  if (arguments_.options.has('compatibility')) {
    compatibility(option(arguments_, 'compatibility'))
  }
}

export function projectPath(arguments_: ParsedArguments) {
  return path.resolve(option(arguments_, 'project') ?? process.cwd())
}

export function target(arguments_: ParsedArguments) {
  const scope = option(arguments_, 'scope')
  if (scope === undefined || scope === 'project') return 'project' as const
  if (scope === 'global') return 'global' as const
  throw new Error(`Unsupported MCP scope ${JSON.stringify(scope)}. Expected "global" or "project".`)
}

export function findServer(view: McpSettingsView, name: string | undefined) {
  if (!name) throw new Error('An MCP server name is required.')
  const server = view.servers.find(
    (candidate) => candidate.name === name || candidate.instanceId === name,
  )
  if (!server) throw new Error(`MCP server ${JSON.stringify(name)} was not found.`)
  return server
}

function transport(value: string | undefined): McpServerTransport | undefined {
  if (
    value === 'stdio' ||
    value === 'streamable-http' ||
    value === 'sse' ||
    value === 'websocket'
  ) {
    return value
  }
  if (value === undefined) return undefined
  throw new Error(
    `Unsupported MCP transport ${JSON.stringify(value)}. Expected stdio, streamable-http, sse, or websocket.`,
  )
}

function compatibility(value: string | undefined): McpCompatibilityProfile | undefined {
  if (
    value === 'auto' ||
    value === 'modern-only' ||
    value === 'legacy-stateful-http' ||
    value === 'legacy-sse' ||
    value === 'legacy-websocket'
  ) {
    return value
  }
  if (value === undefined) return undefined
  throw new Error(
    `Unsupported MCP compatibility profile ${JSON.stringify(value)}. Expected auto, modern-only, legacy-stateful-http, legacy-sse, or legacy-websocket.`,
  )
}

function keyValueMap(values: readonly string[] | undefined, secretReference: boolean) {
  if (!values) return undefined
  const result: Record<string, McpConfigCredentialValue> = {}
  for (const value of values) {
    const separator = value.indexOf('=')
    if (separator < NEXT_ARGUMENT_OFFSET || separator === value.length - NEXT_ARGUMENT_OFFSET) {
      throw new Error(`Expected NAME=VALUE, received ${JSON.stringify(value)}.`)
    }
    const name = value.slice(0, separator)
    const resolved = value.slice(separator + NEXT_ARGUMENT_OFFSET)
    if (!secretReference && SECRET_ARGUMENT_PATTERN.test(name)) {
      throw new Error(`${name} looks sensitive. Use --env-ref NAME=VAULT_SECRET instead.`)
    }
    result[name] = secretReference ? { secret: resolved } : resolved
  }
  return result
}

export function addDefinition(arguments_: ParsedArguments): McpServerDefinition {
  const url = option(arguments_, 'url')
  const command = arguments_.passthrough[0]
  if (Boolean(url) === Boolean(command))
    throw new Error('Provide exactly one --url or a command after --.')
  if (arguments_.passthrough.some((argument) => SECRET_ARGUMENT_PATTERN.test(argument))) {
    throw new Error('Credential-like command arguments are not accepted. Use vault references.')
  }
  const env = {
    ...keyValueMap(arguments_.options.get('env'), false),
    ...keyValueMap(arguments_.options.get('env-ref'), true),
  }
  const headers = keyValueMap(arguments_.options.get('header-ref'), true)
  const selectedTransport = transport(option(arguments_, 'transport'))
  const selectedCompatibility = compatibility(option(arguments_, 'compatibility'))
  const oauthScopes = arguments_.options.get('oauth-scope')
  const oauthDomains = arguments_.options.get('oauth-domain')
  return {
    ...(url ? { url } : {}),
    ...(command ? { command, args: arguments_.passthrough.slice(NEXT_ARGUMENT_OFFSET) } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(headers ? { headers } : {}),
    ...(selectedTransport ? { transport: selectedTransport } : {}),
    ...(selectedCompatibility ? { compatibility: selectedCompatibility } : {}),
    ...(option(arguments_, 'protocol') ? { protocolVersion: option(arguments_, 'protocol') } : {}),
    ...(hasFlag(arguments_, 'oauth')
      ? { auth: { type: 'oauth', ...(oauthScopes ? { scopes: [...oauthScopes] } : {}) } }
      : {}),
    ...(oauthDomains ? { security: { oauthDomains: [...oauthDomains] } } : {}),
  }
}

export function definitionFor(view: McpSettingsView, server: McpServerSummary) {
  const source = view.sources.find((candidate) => candidate.id === server.sourceId)
  if (!source) throw new Error(`MCP source for ${server.name} was not found.`)
  const config = parseMcpConfigFile(source.rawJson)
  const definition = (config.mcpServers ?? config.servers)?.[server.name]
  if (!definition) throw new Error(`MCP definition for ${server.name} was not found.`)
  return definition
}

export async function readSecretFromStdin() {
  if (process.stdin.isTTY)
    throw new Error('Secret input must be piped on stdin; values are never accepted as arguments.')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.byteLength
    if (total > MAX_STDIN_SECRET_BYTES) throw new Error('Secret input exceeded the safety limit.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/[\r\n]+$/, '')
}

export function parseImportSources(value: string | undefined) {
  if (!value || value === 'all') return ALL_IMPORT_SOURCES
  const requested = value.split(',').map((entry) => entry.trim())
  const invalid = requested.filter(
    (entry) => !ALL_IMPORT_SOURCES.some((source) => source === entry),
  )
  if (invalid.length > 0) throw new Error(`Unsupported import sources: ${invalid.join(', ')}.`)
  return ALL_IMPORT_SOURCES.filter((source) => requested.includes(source))
}

export function formatMcpCliOutput(value: unknown, json: boolean) {
  return json
    ? JSON.stringify({ schemaVersion: 1, data: value }, null, MCP_CONFIG.JSON_INDENT_SPACES)
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)
}
