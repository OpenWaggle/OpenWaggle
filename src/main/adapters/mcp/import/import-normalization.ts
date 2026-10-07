/**
 * Conversion of another tool's server entry to Pi's `mcpServers` format, as
 * Pi's "Migrate configuration from another client" describes, plus
 * `type: "sse"` for SSE endpoints (OpenWaggle keeps a legacy SSE transport).
 */
import { isRecord } from '@shared/utils/validation'
import type { ExternalMcpImportSource, PiMcpEntry } from './import-types'
import {
  credentialMap,
  type ImportValueContext,
  nonEmptyString,
  portableArgs,
  portableString,
  stringArray,
} from './import-values'

type Raw = Record<string, unknown>

const GENERIC_FIELDS = [
  'command',
  'args',
  'cwd',
  'env',
  'url',
  'headers',
  'type',
  'enabled',
  'disabled',
  'description',
  'oauth',
]

/** Source fields that are converted or deliberately dropped, so they are not reported as unknown. */
const SOURCE_FIELDS: Readonly<Record<ExternalMcpImportSource, readonly string[]>> = {
  codex: [
    'http_headers',
    'env_http_headers',
    'bearer_token_env_var',
    'tool_timeout_sec',
    'startup_timeout_sec',
    'startup_timeout_ms',
    'enabled_tools',
    'disabled_tools',
  ],
  'claude-code': [],
  'claude-desktop': [],
  cursor: [],
  vscode: [],
  opencode: ['environment'],
  zed: ['source'],
  windsurf: ['serverUrl'],
}

const IMPLICIT_TYPES = new Set([
  'stdio',
  'local',
  'http',
  'streamable-http',
  'streamableHttp',
  'remote',
])
const PI_OAUTH_STRING_FIELDS = ['clientId', 'clientSecret', 'callbackUrl', 'clientName']
const CODEX_FALLBACK_TOOL_PATTERN = '*'

/** Reshape source-specific layouts into the generic `mcpServers` layout. */
function reshape(source: ExternalMcpImportSource, value: Raw): Raw {
  if (source === 'zed' && isRecord(value.command)) {
    const { path: command, args, env } = value.command
    return { ...value, command, args, env }
  }
  if (source === 'opencode' && value.environment !== undefined && value.env === undefined) {
    return { ...value, env: value.environment }
  }
  if (source === 'windsurf' && value.url === undefined) return { ...value, url: value.serverUrl }
  return value
}

function endpointFields(value: Raw, context: ImportValueContext): PiMcpEntry {
  const commandArray = stringArray(value.command)
  const command = commandArray?.[0] ?? nonEmptyString(value.command)
  const args = portableArgs(commandArray?.slice(1) ?? stringArray(value.args) ?? [], context)
  const cwd = nonEmptyString(value.cwd)
  const url = nonEmptyString(value.url)
  return {
    ...(command ? { command } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(url ? { url } : {}),
  }
}

function typeField(value: Raw, context: ImportValueContext): PiMcpEntry {
  const type = value.type
  if (type === undefined || (typeof type === 'string' && IMPLICIT_TYPES.has(type))) return {}
  if (type === 'sse') return { type: 'sse' }
  context.warnings.push(`type ${String(type)} is not supported and was not imported.`)
  return {}
}

function codexHeaders(value: Raw, context: ImportValueContext) {
  const headers: Record<string, string> = {}
  const bearer = nonEmptyString(value.bearer_token_env_var)
  if (bearer) headers.Authorization = `Bearer \${${bearer}}`
  if (isRecord(value.env_http_headers)) {
    for (const [header, variable] of Object.entries(value.env_http_headers)) {
      if (typeof variable === 'string') headers[header] = `\${${variable}}`
      else
        context.warnings.push(`env_http_headers.${header} was ignored because it is not a string.`)
    }
  }
  return headers
}

function credentialFields(
  source: ExternalMcpImportSource,
  value: Raw,
  context: ImportValueContext,
): PiMcpEntry {
  const env = credentialMap(value.env, 'env', context)
  const headerSource = source === 'codex' ? (value.http_headers ?? value.headers) : value.headers
  const headers = {
    ...credentialMap(headerSource, 'headers', context),
    ...(source === 'codex' ? codexHeaders(value, context) : {}),
  }
  return {
    ...(env ? { env } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function oauthValue(key: string, entry: unknown, context: ImportValueContext) {
  if (PI_OAUTH_STRING_FIELDS.includes(key) && typeof entry === 'string') {
    return portableString(entry, `oauth.${key}`, context)
  }
  if (key === 'scope' && typeof entry === 'string') return entry
  if (key === 'scope' && Array.isArray(entry)) return (stringArray(entry) ?? []).join(' ')
  if (key === 'callbackPort' && typeof entry === 'number') return entry
  return undefined
}

function oauthField(value: Raw, context: ImportValueContext): PiMcpEntry {
  if (!isRecord(value.oauth)) return {}
  const oauth: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value.oauth)) {
    const converted = oauthValue(key, entry, context)
    if (converted === undefined) {
      context.warnings.push(`oauth.${key} has no Pi equivalent and was not imported.`)
      continue
    }
    oauth[key] = converted
  }
  return Object.keys(oauth).length > 0 ? { oauth } : {}
}

function codexToolExposure(value: Raw): PiMcpEntry {
  const enabled = stringArray(value.enabled_tools)
  const disabled = stringArray(value.disabled_tools) ?? []
  const exposure: Record<string, string> = {}
  if (enabled) {
    for (const name of enabled) exposure[name] = 'codemode'
    exposure[CODEX_FALLBACK_TOOL_PATTERN] = 'hidden'
  }
  for (const name of disabled) exposure[name] = 'hidden'
  return Object.keys(exposure).length > 0 ? { toolExposure: exposure } : {}
}

function codexFields(value: Raw, context: ImportValueContext): PiMcpEntry {
  if (value.startup_timeout_sec !== undefined || value.startup_timeout_ms !== undefined) {
    context.warnings.push('The startup timeout has no Pi equivalent and was not imported.')
  }
  const timeout =
    typeof value.tool_timeout_sec === 'number' && value.tool_timeout_sec > 0
      ? { timeout: value.tool_timeout_sec }
      : {}
  return { ...timeout, ...codexToolExposure(value) }
}

function stateFields(value: Raw): PiMcpEntry {
  const description = nonEmptyString(value.description)
  return {
    ...(value.enabled === false || value.disabled === true ? { enabled: false } : {}),
    ...(description ? { description } : {}),
  }
}

function warnUnknownFields(
  source: ExternalMcpImportSource,
  value: Raw,
  context: ImportValueContext,
) {
  const known = new Set([...GENERIC_FIELDS, ...SOURCE_FIELDS[source]])
  for (const field of Object.keys(value)) {
    if (!known.has(field))
      context.warnings.push(`${source} field ${field} has no Pi equivalent and was not imported.`)
  }
}

export interface NormalizedImport {
  readonly entry: PiMcpEntry
  readonly warnings: readonly string[]
}

export function normalizeImportedEntry(
  source: ExternalMcpImportSource,
  name: string,
  value: unknown,
): NormalizedImport | undefined {
  if (!isRecord(value)) return undefined
  const context: ImportValueContext = { serverName: name, warnings: [] }
  const shaped = reshape(source, value)
  const entry: PiMcpEntry = {
    ...endpointFields(shaped, context),
    ...typeField(shaped, context),
    ...credentialFields(source, shaped, context),
    ...oauthField(shaped, context),
    ...(source === 'codex' ? codexFields(shaped, context) : {}),
    ...stateFields(shaped),
  }
  warnUnknownFields(source, value, context)
  if (entry.command === undefined && entry.url === undefined) {
    context.warnings.push('No portable command or URL was found; this server cannot be imported.')
  }
  return { entry, warnings: context.warnings }
}
