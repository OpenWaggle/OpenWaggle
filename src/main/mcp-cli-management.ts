import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpWriteDestination,
} from '@shared/types/mcp-configuration'
import { CliError, cliExitCodeForKind } from './cli-error'
import {
  McpCliUsageError,
  type McpManagementCommand,
  mcpCliAddInput,
  mcpCliProjectPath,
  parseMcpManagementArguments,
  requireServerName,
} from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementContext,
  type McpManagementExit,
} from './mcp-cli-management-context'
import { doctorCommand } from './mcp-cli-management-doctor'
import { importCommand } from './mcp-cli-management-import'
import { listCommand, projectOptionOf } from './mcp-cli-management-list'
import { registryCommand } from './mcp-cli-management-registry'
import { writeSessionsCliError } from './sessions-cli-output'

export type { McpCliHost } from './mcp-cli-management-context'

/**
 * `openwaggle mcp add|remove|list|enable|disable|login|logout|import`, mirroring `pi mcp`, plus
 * `registry` and `doctor`. Every command runs in the Session Host through the MCP Host UI
 * channels, so the CLI and Settings > MCP change the same files the same way.
 */

function scopeOf(destination: McpWriteDestination): McpConfigFileScope {
  return destination === 'pi-global' || destination === 'openwaggle-global' ? 'global' : 'project'
}

function defaultDestination(scope: McpConfigFileScope): McpWriteDestination {
  return scope === 'global' ? 'openwaggle-global' : 'project-openwaggle'
}

function findServer(view: McpConfigurationView, name: string) {
  return view.servers.find((server) => server.name === name)
}

function missingServer(view: McpConfigurationView, name: string) {
  const configured = view.servers.map((server) => server.name).join(', ') || 'none'
  return new Error(`No MCP server named "${name}". Configured: ${configured}.`)
}

async function addCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  const input = mcpCliAddInput(args)
  const scope = input.destination ? scopeOf(input.destination) : projectPath ? 'project' : 'global'
  const destination = input.destination ?? defaultDestination(scope)
  const before = await context.host.invoke('mcp:get-configuration', { projectPath })
  const filePath = before.files.find((file) => file.fileId === destination)?.path ?? destination
  const replaced = before.servers.some(
    (server) => server.name === input.name && server.source.path === filePath,
  )
  const after = await context.host.invoke('mcp:add-server', {
    projectPath,
    name: input.name,
    scope,
    entry: input.entry,
    ...(input.destination ? { destination: input.destination } : {}),
  })
  context.output.log(
    `${replaced ? 'Replaced' : 'Added'} ${scope} MCP server "${input.name}" in ${filePath}.`,
  )
  // `-l` or `--project <path>`, as the command was given, so the hints act on the same project.
  const project = projectOptionOf({ args, projectPath })
  const signIn = findServer(after, input.name)?.usesOAuth
    ? `. If it requires sign-in: openwaggle mcp login ${input.name}${project}`
    : ''
  context.output.log(`Check it with: openwaggle mcp list${project}${signIn}`)
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

async function removeCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  const name = requireServerName('remove', args)
  const view = await context.host.invoke('mcp:get-configuration', { projectPath })
  const server = findServer(view, name)
  if (!server) throw missingServer(view, name)
  await context.host.invoke('mcp:remove-server', { projectPath, name })
  context.output.log(`Removed ${server.scope} MCP server "${name}" from ${server.source.path}.`)
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

async function setEnabledCommand(
  enabled: boolean,
  { args, projectPath, context }: McpManagementCommandInput,
): Promise<McpManagementExit> {
  const name = requireServerName(enabled ? 'enable' : 'disable', args)
  const inProject = args.flags.has('in-project')
  const scopedProject = projectPath ?? (inProject ? context.workingDirectory : null)
  const view = await context.host.invoke('mcp:set-server-enabled', {
    projectPath: scopedProject,
    name,
    enabled,
    target: inProject ? 'project' : 'server',
  })
  const server = findServer(view, name)
  const savedTo = server?.override?.path ?? server?.source.path ?? 'its file'
  context.output.log(
    `${enabled ? 'Enabled' : 'Disabled'} MCP server "${name}"${inProject ? ' in this project' : ''}; saved to ${savedTo}.`,
  )
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

function requireOAuthServer(view: McpConfigurationView, name: string) {
  const server = findServer(view, name)
  if (!server) throw missingServer(view, name)
  if (!server.usesOAuth) {
    throw new Error(
      `MCP server "${name}" does not use OAuth. Only HTTP servers without an Authorization header do.`,
    )
  }
  return server
}

async function loginCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  const name = requireServerName('login', args)
  requireOAuthServer(await context.host.invoke('mcp:get-configuration', { projectPath }), name)
  const result = await context.host.invoke('mcp:sign-in', { projectPath, name })
  if (result.signedIn) {
    context.output.log(`Signed in to MCP server "${name}".`)
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  context.output.error(
    result.authorizationUrl
      ? `Sign-in to MCP server "${name}" did not finish. Open this page to sign in:\n${result.authorizationUrl}`
      : `Sign-in to MCP server "${name}" was cancelled.`,
  )
  return MCP_MANAGEMENT_EXIT.FAILURE
}

async function logoutCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  const name = requireServerName('logout', args)
  requireOAuthServer(await context.host.invoke('mcp:get-configuration', { projectPath }), name)
  await context.host.invoke('mcp:sign-out', { projectPath, name })
  context.output.log(`Signed out of MCP server "${name}".`)
  return MCP_MANAGEMENT_EXIT.SUCCESS
}

const COMMANDS: Readonly<
  Record<McpManagementCommand, (input: McpManagementCommandInput) => Promise<McpManagementExit>>
> = {
  add: addCommand,
  remove: removeCommand,
  list: listCommand,
  enable: (input) => setEnabledCommand(true, input),
  disable: (input) => setEnabledCommand(false, input),
  login: loginCommand,
  logout: logoutCommand,
  import: importCommand,
  registry: registryCommand,
  doctor: doctorCommand,
}

export async function runMcpManagementCommand(
  command: McpManagementCommand,
  rawArgs: readonly string[],
  context: McpManagementContext,
): Promise<number> {
  try {
    const args = parseMcpManagementArguments(command, rawArgs)
    const projectPath = mcpCliProjectPath(
      args,
      context.resolveProjectPath,
      context.workingDirectory,
    )
    return await COMMANDS[command]({ args, projectPath, context })
  } catch (error) {
    const typed =
      error instanceof McpCliUsageError
        ? new CliError('usage', error.message, { cause: error })
        : error
    const kind = writeSessionsCliError(typed, rawArgs.includes('--json'), (text) =>
      context.output.error(text.trimEnd()),
    )
    return cliExitCodeForKind(kind)
  }
}
