import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpConfigFileView,
  McpConfiguredServerView,
  McpServerInspection,
} from '@shared/types/mcp-configuration'
import { McpCliUsageError } from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementExit,
} from './mcp-cli-management-context'
import { inspectEnabledServers } from './mcp-cli-management-inspect'
import { projectOptionOf } from './mcp-cli-management-list'

/**
 * `openwaggle mcp doctor`: which MCP files exist, what Pi could not read in them, and the state
 * of every server. It connects to each enabled server, as `openwaggle mcp list` does.
 */

interface DoctorServer {
  readonly name: string
  readonly scope: string
  readonly source: string
  readonly override?: string
  readonly enabled: boolean
  readonly state: string
  readonly tools: number
  readonly error?: string
  readonly stderrTail?: string
}

function doctorServer(
  server: McpConfiguredServerView,
  inspection: McpServerInspection | undefined,
): DoctorServer {
  const failed = inspection !== undefined && inspection.state !== 'connected'
  return {
    name: server.name,
    scope: server.scope,
    source: server.source.path,
    ...(server.override ? { override: server.override.path } : {}),
    enabled: server.enabled,
    state: inspection?.state ?? 'disabled',
    tools: inspection?.tools.length ?? 0,
    ...(failed && inspection.error ? { error: inspection.error } : {}),
    ...(failed && inspection.stderrTail ? { stderrTail: inspection.stderrTail } : {}),
  }
}

function indent(text: string, prefix: string) {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function fileLines(files: readonly McpConfigFileView[], projectPath: string | null) {
  return [
    'Files (lowest priority first):',
    ...files.map(
      (file) => `  ${file.exists ? 'found  ' : 'missing'}  ${file.path} (${file.fileId})`,
    ),
    ...(projectPath ? [] : ['  Project files are checked with -l or --project <path>.']),
  ]
}

function stateLabel(server: DoctorServer) {
  if (server.state === 'connected') {
    return `connected, ${String(server.tools)} tool${server.tools === 1 ? '' : 's'}`
  }
  return server.state === 'needs-sign-in' ? 'needs sign-in' : server.state
}

function serverLines(servers: readonly DoctorServer[], projectOption: string) {
  if (servers.length === 0) return ['Servers: none configured.']
  return [
    'Servers:',
    ...servers.flatMap((server) => [
      `  ${server.name}: ${stateLabel(server)} (${server.scope}, ${server.source})`,
      ...(server.override ? [`    override: ${server.override}`] : []),
      ...(server.state === 'needs-sign-in'
        ? [`    sign in with: openwaggle mcp login ${server.name}${projectOption}`]
        : []),
      ...(server.error ? [indent(server.error, '    ')] : []),
      ...(server.stderrTail ? ['    stderr:', indent(server.stderrTail, '      ')] : []),
    ]),
  ]
}

export async function doctorCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  if (args.positional.length > 0) {
    throw new McpCliUsageError('Usage: openwaggle mcp doctor [--json] [-l]')
  }
  const view = await context.host.invoke('mcp:get-configuration', { projectPath })
  const inspections = await inspectEnabledServers(context, projectPath, view.servers)
  const servers = view.servers.map((server) => doctorServer(server, inspections.get(server.name)))
  const ok =
    view.errors.length === 0 &&
    servers.every((server) => !server.enabled || server.state === 'connected')
  if (args.flags.has('json')) {
    const report = { ok, files: view.files, errors: view.errors, servers }
    context.output.log(JSON.stringify(report, null, MCP_CONFIG.JSON_INDENT_SPACES))
  } else {
    const errors =
      view.errors.length > 0
        ? ['Configuration errors:', ...view.errors.map((error) => indent(error, '  '))]
        : ['Configuration errors: none.']
    context.output.log(
      [
        ...fileLines(view.files, projectPath),
        ...errors,
        ...serverLines(servers, projectOptionOf({ args, projectPath })),
      ].join('\n'),
    )
    context.output.log(ok ? 'Everything looks fine.' : 'Some MCP servers need attention.')
  }
  return ok ? MCP_MANAGEMENT_EXIT.SUCCESS : MCP_MANAGEMENT_EXIT.FAILURE
}
