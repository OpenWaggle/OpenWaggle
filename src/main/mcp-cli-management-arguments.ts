import {
  MCP_CONFIG_FILE_ID_VALUES,
  type McpWriteDestination,
} from '@shared/types/mcp-configuration'
import {
  MCP_IMPORT_SOURCE_IDS,
  type McpImportNameConflictPolicy,
  type McpImportSourceId,
} from '@shared/types/mcp-configuration-operations'

/**
 * Arguments of `openwaggle mcp add|remove|list|enable|disable|login|logout|import|registry|doctor`.
 * They follow
 * `pi mcp` (Pi's `docs/cli.md`, "MCP commands"): `--` or the second positional ends the options of
 * `add`, so a server command keeps its own flags, and `-l`/`--local` selects the project. New
 * servers go to OpenWaggle's file for the scope unless `--file` names another (ADR 0051).
 */

export const MCP_MANAGEMENT_COMMANDS = [
  'add',
  'remove',
  'list',
  'enable',
  'disable',
  'login',
  'logout',
  'import',
  'registry',
  'doctor',
] as const

export type McpManagementCommand = (typeof MCP_MANAGEMENT_COMMANDS)[number]

export function isMcpManagementCommand(value: string | undefined): value is McpManagementCommand {
  return MCP_MANAGEMENT_COMMANDS.some((command) => command === value)
}

export class McpCliUsageError extends Error {}

type OptionKind = 'flag' | 'value' | 'list'

export interface McpManagementArguments {
  readonly positional: readonly string[]
  readonly flags: ReadonlySet<string>
  readonly values: ReadonlyMap<string, string>
  readonly lists: ReadonlyMap<string, readonly string[]>
}

const OPTION_ALIASES: ReadonlyMap<string, string> = new Map([['-l', '--local']])
const PROJECT_OPTIONS = { local: 'flag', project: 'value' } as const
const ADD_POSITIONALS_BEFORE_COMMAND = 2

const COMMAND_OPTIONS: Readonly<
  Record<McpManagementCommand, Readonly<Record<string, OptionKind>>>
> = {
  add: {
    ...PROJECT_OPTIONS,
    url: 'value',
    env: 'list',
    'env-secret': 'list',
    cwd: 'value',
    header: 'list',
    'header-secret': 'list',
    'bearer-token-env-var': 'value',
    'oauth-client-id': 'value',
    'oauth-client-secret': 'value',
    'oauth-callback-port': 'value',
    'oauth-client-name': 'value',
    exposure: 'value',
    description: 'value',
    file: 'value',
  },
  remove: PROJECT_OPTIONS,
  list: { ...PROJECT_OPTIONS, json: 'flag' },
  enable: { ...PROJECT_OPTIONS, 'in-project': 'flag' },
  disable: { ...PROJECT_OPTIONS, 'in-project': 'flag' },
  login: PROJECT_OPTIONS,
  logout: PROJECT_OPTIONS,
  import: {
    ...PROJECT_OPTIONS,
    from: 'value',
    apply: 'flag',
    server: 'list',
    conflict: 'value',
    json: 'flag',
  },
  registry: {
    ...PROJECT_OPTIONS,
    name: 'value',
    package: 'value',
    registry: 'value',
    scope: 'value',
    version: 'value',
    exposure: 'value',
    json: 'flag',
  },
  doctor: { ...PROJECT_OPTIONS, json: 'flag' },
}

/** Parses `--name value` options; `--`, or reaching `maxPositionals`, ends them. */
export function parseMcpManagementArguments(
  command: McpManagementCommand,
  args: readonly string[],
): McpManagementArguments {
  const known = COMMAND_OPTIONS[command]
  const maxPositionals =
    command === 'add' ? ADD_POSITIONALS_BEFORE_COMMAND : Number.POSITIVE_INFINITY
  const positional: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const lists = new Map<string, string[]>()
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? ''
    const arg = OPTION_ALIASES.get(raw) ?? raw
    if (arg === '--' || positional.length >= maxPositionals) {
      positional.push(...args.slice(arg === '--' ? index + 1 : index))
      break
    }
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice('--'.length)
    const kind = known[name]
    if (!kind) throw new McpCliUsageError(`Unknown option ${arg}.`)
    if (kind === 'flag') {
      flags.add(name)
      continue
    }
    index += 1
    const value = args[index]
    if (value === undefined) throw new McpCliUsageError(`${arg} needs a value.`)
    if (kind === 'list') lists.set(name, [...(lists.get(name) ?? []), value])
    else values.set(name, value)
  }
  return { positional, flags, values, lists }
}

/** The project the command reads and writes: `--project`, the current directory for `-l`, or none. */
export function mcpCliProjectPath(
  args: McpManagementArguments,
  resolve: (projectPath: string) => string,
  workingDirectory: string,
) {
  const explicit = args.values.get('project')
  if (explicit !== undefined) return resolve(explicit)
  return args.flags.has('local') ? workingDirectory : null
}

/** The single `<server>` positional of remove, enable, disable, login, and logout. */
export function requireServerName(command: McpManagementCommand, args: McpManagementArguments) {
  const [name, ...extra] = args.positional
  if (!name || extra.length > 0) {
    throw new McpCliUsageError(`Usage: openwaggle mcp ${command} <server> [-l]`)
  }
  return name
}

function pairs(option: string, values: readonly string[] | undefined) {
  const record: Record<string, string> = {}
  for (const pair of values ?? []) {
    const separator = pair.indexOf('=')
    if (separator <= 0) throw new McpCliUsageError(`--${option} expects KEY=VALUE, got "${pair}".`)
    record[pair.slice(0, separator)] = pair.slice(separator + 1)
  }
  return record
}

function secretPairs(option: string, values: readonly string[] | undefined) {
  return Object.fromEntries(
    Object.entries(pairs(option, values)).map(([key, name]) => [key, { secret: name }]),
  )
}

const HTTP_ONLY = [
  'header',
  'header-secret',
  'bearer-token-env-var',
  'oauth-client-id',
  'oauth-client-secret',
  'oauth-callback-port',
  'oauth-client-name',
]
const STDIO_ONLY = ['env', 'env-secret', 'cwd']

function isGiven(args: McpManagementArguments, option: string) {
  return args.values.has(option) || args.lists.has(option)
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function httpEntry(args: McpManagementArguments, url: string): Record<string, JsonValue> {
  const headers: Record<string, JsonValue> = {
    ...pairs('header', args.lists.get('header')),
    ...secretPairs('header-secret', args.lists.get('header-secret')),
  }
  const bearer = args.values.get('bearer-token-env-var')
  if (bearer !== undefined) headers.Authorization = `Bearer \${${bearer}}`
  const port = args.values.get('oauth-callback-port')
  if (port !== undefined && !/^\d+$/.test(port)) {
    throw new McpCliUsageError('--oauth-callback-port must be a port number.')
  }
  const oauthOptions: readonly (readonly [string, string])[] = [
    ['oauth-client-id', 'clientId'],
    ['oauth-client-secret', 'clientSecret'],
    ['oauth-client-name', 'clientName'],
  ]
  const oauth: Record<string, JsonValue> = {}
  for (const [option, key] of oauthOptions) {
    const value = args.values.get(option)
    if (value !== undefined) oauth[key] = value
  }
  if (port !== undefined) oauth.callbackPort = Number(port)
  return {
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(oauth).length > 0 ? { oauth } : {}),
  }
}

function stdioEntry(args: McpManagementArguments, command: readonly string[]) {
  const [executable = '', ...commandArgs] = command
  const env: Record<string, JsonValue> = {
    ...pairs('env', args.lists.get('env')),
    ...secretPairs('env-secret', args.lists.get('env-secret')),
  }
  const cwd = args.values.get('cwd')
  return {
    command: executable,
    ...(commandArgs.length > 0 ? { args: commandArgs } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

export interface McpCliAddInput {
  readonly name: string
  readonly entry: Readonly<Record<string, JsonValue>>
  readonly destination?: McpWriteDestination
}

/** The Pi entry `pi mcp add` would write for these arguments. The Host validates it like Pi. */
export function mcpCliAddInput(args: McpManagementArguments): McpCliAddInput {
  const [name, ...command] = args.positional
  const url = args.values.get('url')
  if (!name || (url === undefined) === (command.length === 0)) {
    throw new McpCliUsageError(
      'Usage: openwaggle mcp add <server> [options] (--url <url> | -- <command> [args...])',
    )
  }
  const misplaced = (url === undefined ? HTTP_ONLY : STDIO_ONLY).find((option) =>
    isGiven(args, option),
  )
  if (misplaced) {
    throw new McpCliUsageError(
      `--${misplaced} only applies to ${url === undefined ? 'HTTP servers (--url)' : 'stdio servers'}.`,
    )
  }
  const entry: Record<string, JsonValue> =
    url === undefined ? stdioEntry(args, command) : httpEntry(args, url)
  const exposure = args.values.get('exposure')
  if (exposure !== undefined) entry.exposure = exposure
  const description = args.values.get('description')
  if (description !== undefined) entry.description = description
  const file = args.values.get('file')
  const destination = MCP_CONFIG_FILE_ID_VALUES.find((candidate) => candidate === file)
  if (file !== undefined && !destination) {
    throw new McpCliUsageError(
      `--file must be one of ${MCP_CONFIG_FILE_ID_VALUES.join(', ')}; got "${file}".`,
    )
  }
  return { name, entry, ...(destination ? { destination } : {}) }
}

export function mcpCliImportSources(
  args: McpManagementArguments,
): readonly McpImportSourceId[] | undefined {
  const from = args.values.get('from')
  if (from === undefined) return undefined
  return from.split(',').map((value) => {
    const source = MCP_IMPORT_SOURCE_IDS.find((candidate) => candidate === value.trim())
    if (!source) {
      throw new McpCliUsageError(
        `Unknown import source "${value.trim()}". Expected ${MCP_IMPORT_SOURCE_IDS.join(', ')}.`,
      )
    }
    return source
  })
}

export function mcpCliConflictPolicy(args: McpManagementArguments): McpImportNameConflictPolicy {
  const value = args.values.get('conflict') ?? 'skip'
  if (value === 'skip' || value === 'replace' || value === 'rename') return value
  throw new McpCliUsageError(`--conflict must be skip, replace, or rename; got "${value}".`)
}
