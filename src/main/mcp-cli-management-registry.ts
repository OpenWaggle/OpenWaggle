import { MCP_CONFIG } from '@shared/constants/mcp'
import { MCP_EXPOSURE_VALUES, type McpConfigFileScope } from '@shared/types/mcp-configuration'
import {
  MCP_REGISTRY_PACKAGE_TYPES,
  type McpRegistryInstallRequest,
  type McpRegistryServerView,
} from '@shared/types/mcp-registry'
import { McpCliUsageError, type McpManagementArguments } from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementExit,
} from './mcp-cli-management-context'

/**
 * `openwaggle mcp registry search|get|add`: the MCP Registry through the Session Host. `add`
 * saves an ordinary Pi entry to OpenWaggle's MCP file, like `openwaggle mcp add` would.
 */

const USAGE =
  'Usage: openwaggle mcp registry search [<query>] | get <name> | add <name> [--package <type>] [--name <server>] [-l]'

function serverLines(server: McpRegistryServerView) {
  const runsAs = server.installOptions.map((option) => `${option.method} ${option.target}`)
  return [
    `${server.name} (${server.version})${server.description ? `: ${server.description}` : ''}`,
    `  runs as: ${runsAs.length > 0 ? runsAs.join(', ') : 'nothing OpenWaggle can run'}`,
    ...(server.repositoryUrl ? [`  source: ${server.repositoryUrl}`] : []),
  ]
}

function registryUrl(args: McpManagementArguments) {
  const url = args.values.get('registry')
  return url === undefined ? {} : { registryUrl: url }
}

function printJson(input: McpManagementCommandInput, value: unknown) {
  input.context.output.log(JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES))
}

async function searchCommand(input: McpManagementCommandInput, query: readonly string[]) {
  const { args, context } = input
  const result = await context.host.invoke('mcp:search-registry', {
    query: query.join(' '),
    ...registryUrl(args),
  })
  if (args.flags.has('json')) {
    printJson(input, result)
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  if (result.servers.length === 0) {
    context.output.log(`No MCP Registry servers match "${query.join(' ')}".`)
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  for (const server of result.servers) context.output.log(serverLines(server).join('\n'))
  context.output.log('Install one with: openwaggle mcp registry add <name> [-l]')
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

function requireRegistryName(rest: readonly string[]) {
  const [name, ...extra] = rest
  if (!name || extra.length > 0) throw new McpCliUsageError(USAGE)
  return name
}

async function getCommand(input: McpManagementCommandInput, rest: readonly string[]) {
  const { args, context } = input
  const version = args.values.get('version')
  const server = await context.host.invoke('mcp:get-registry-server', {
    registryName: requireRegistryName(rest),
    ...(version ? { version } : {}),
    ...registryUrl(args),
  })
  if (args.flags.has('json')) printJson(input, server)
  else context.output.log(serverLines(server).join('\n'))
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

function oneOf<T extends string>(option: string, value: string | undefined, values: readonly T[]) {
  if (value === undefined) return undefined
  const found = values.find((candidate) => candidate === value)
  if (!found) {
    throw new McpCliUsageError(`--${option} must be one of ${values.join(', ')}; got "${value}".`)
  }
  return found
}

/** `--scope` as before, else the project with `-l` or `--project`, else all projects. */
function installScope(input: McpManagementCommandInput) {
  const scope: McpConfigFileScope | undefined = oneOf('scope', input.args.values.get('scope'), [
    'global',
    'project',
  ])
  if (scope === 'global') return { scope, projectPath: input.projectPath }
  if (scope === 'project' || input.projectPath !== null) {
    return {
      scope: 'project' as const,
      projectPath: input.projectPath ?? input.context.workingDirectory,
    }
  }
  return { scope: 'global' as const, projectPath: null }
}

function installRequest(input: McpManagementCommandInput, registryName: string) {
  const { args } = input
  const method = oneOf('package', args.values.get('package'), MCP_REGISTRY_PACKAGE_TYPES)
  const exposure = oneOf('exposure', args.values.get('exposure'), MCP_EXPOSURE_VALUES)
  const serverName = args.values.get('name')
  const version = args.values.get('version')
  return {
    ...installScope(input),
    registryName,
    ...registryUrl(args),
    ...(version ? { version } : {}),
    ...(method ? { method } : {}),
    ...(serverName ? { serverName } : {}),
    ...(exposure ? { exposure } : {}),
  } satisfies McpRegistryInstallRequest
}

async function addCommand(input: McpManagementCommandInput, rest: readonly string[]) {
  const { args, context } = input
  const request = installRequest(input, requireRegistryName(rest))
  const result = await context.host.invoke('mcp:install-registry-server', request)
  if (args.flags.has('json')) {
    printJson(input, { name: result.name, filePath: result.filePath, secrets: result.secrets })
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  context.output.log(
    `Installed ${request.scope} MCP server "${result.name}" from the MCP Registry in ${result.filePath}.`,
  )
  if (result.secrets.length > 0) {
    context.output.log(
      `It reads the vault secret${result.secrets.length === 1 ? '' : 's'} ${result.secrets.join(', ')}. Add ${result.secrets.length === 1 ? 'it' : 'them'} in Settings > MCP > Secrets before using it.`,
    )
  }
  const local = request.projectPath ? ' -l' : ''
  context.output.log(`Check it with: openwaggle mcp list${local}`)
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

export async function registryCommand(
  input: McpManagementCommandInput,
): Promise<McpManagementExit> {
  const [action = 'search', ...rest] = input.args.positional
  if (action === 'search') return searchCommand(input, rest)
  if (action === 'get') return getCommand(input, rest)
  if (action === 'add') return addCommand(input, rest)
  throw new McpCliUsageError(USAGE)
}
