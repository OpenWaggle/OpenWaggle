import { MCP_EXPOSURE_VALUES, type McpConfigFileScope } from '@shared/types/mcp-configuration'
import {
  MCP_REGISTRY_PACKAGE_TYPES,
  type McpRegistryInstallRequest,
  type McpRegistryInstallResultView,
  type McpRegistryServerView,
} from '@shared/types/mcp-registry'
import { mcpCliJsonResponse } from './mcp-cli-io'
import { McpCliUsageError, type McpManagementArguments } from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementExit,
} from './mcp-cli-management-context'
import { projectOptionOf } from './mcp-cli-management-list'

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
  input.context.output.log(mcpCliJsonResponse('registry', value))
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

/** The optional secrets an install left out, and how to add one. */
function optionalSecretLines(result: McpRegistryInstallResultView) {
  const lines: string[] = []
  const optional = result.optionalSecrets
  if (optional.length > 0) {
    const one = optional.length === 1
    const how = result.optionalSecretsNeedContainerEnv
      ? `add it to env in ${result.filePath} with a vault secret, and add -e NAME to args before the image so the container receives it.`
      : `add it to the entry in ${result.filePath} with a vault secret.`
    lines.push(
      `It can also use the optional secret${one ? '' : 's'} ${optional.join(', ')}, which ${one ? 'was' : 'were'} left out so it starts without ${one ? 'it' : 'them'}. To use one, ${how}`,
    )
  }
  const flags = result.optionalSecretArguments
  if (flags.length > 0) {
    const one = flags.length === 1
    lines.push(
      `It also takes the optional argument${one ? '' : 's'} ${flags.join(', ')}, which ${one ? 'was' : 'were'} left out: ${one ? 'it needs' : 'they need'} a literal value in args, since a command line cannot read a vault secret.`,
    )
  }
  return lines
}

/** What to tell the user about the vault secrets an installed or imported server reads. */
export function vaultSecretLines(secrets: readonly string[], existingSecrets: readonly string[]) {
  const stored = new Set(existingSecrets)
  const missing = secrets.filter((secret) => !stored.has(secret))
  const lines: string[] = []
  if (missing.length > 0) {
    lines.push(
      `It reads the vault secret${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} in Settings > MCP > Secrets before using it.`,
    )
  }
  if (existingSecrets.length > 0) {
    const one = existingSecrets.length === 1
    lines.push(
      `It uses the vault secret${one ? '' : 's'} ${existingSecrets.join(', ')}, which already exist${one ? 's' : ''}; replace ${one ? 'it' : 'them'} in Settings > MCP > Secrets if ${one ? 'it holds' : 'they hold'} another value.`,
    )
  }
  return lines
}

async function addCommand(input: McpManagementCommandInput, rest: readonly string[]) {
  const { args, context } = input
  const request = installRequest(input, requireRegistryName(rest))
  const result = await context.host.invoke('mcp:install-registry-server', request)
  if (args.flags.has('json')) {
    printJson(input, {
      name: result.name,
      filePath: result.filePath,
      secrets: result.secrets,
      existingSecrets: result.existingSecrets,
      optionalSecrets: result.optionalSecrets,
      optionalSecretArguments: result.optionalSecretArguments,
      optionalSecretsNeedContainerEnv: result.optionalSecretsNeedContainerEnv,
    })
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  context.output.log(
    `Installed ${request.scope} MCP server "${result.name}" from the MCP Registry in ${result.filePath}.`,
  )
  for (const line of vaultSecretLines(result.secrets, result.existingSecrets)) {
    context.output.log(line)
  }
  for (const line of optionalSecretLines(result)) context.output.log(line)
  const project = request.projectPath
    ? projectOptionOf({ args, projectPath: request.projectPath })
    : ''
  context.output.log(`Check it with: openwaggle mcp list${project}`)
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
