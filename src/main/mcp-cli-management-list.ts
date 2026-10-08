import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpConfigFileScope,
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

/** `openwaggle mcp list`: connects to every enabled server and prints what `pi mcp list` prints. */

const SHELL_SAFE_PATH = /^[\w./:@+-]+$/u

/**
 * The project option a suggested command needs to reach the same project as the one that ran:
 * ` -l` or ` --project <path>`, or nothing for the global files.
 */
export function projectOptionOf(input: Pick<McpManagementCommandInput, 'args' | 'projectPath'>) {
  if (!input.projectPath) return ''
  if (!input.args.values.has('project')) return ' -l'
  const quoted = SHELL_SAFE_PATH.test(input.projectPath)
    ? input.projectPath
    : `'${input.projectPath.replaceAll("'", "'\\''")}'`
  return ` --project ${quoted}`
}

interface ServerReport {
  readonly name: string
  readonly scope: McpConfigFileScope
  readonly source: string
  readonly override?: string
  readonly enabled: boolean
  readonly exposure: string
  readonly transport: string
  readonly state: string
  readonly tools: readonly string[]
  readonly toolExposure?: Readonly<Record<string, string>>
  readonly error?: string
}

function report(server: McpConfiguredServerView, inspection?: McpServerInspection): ServerReport {
  const overrides = (inspection?.tools ?? []).flatMap((tool) =>
    tool.exposure === server.exposure ? [] : [[tool.name, tool.exposure] as const],
  )
  return {
    name: server.name,
    scope: server.scope,
    source: server.source.path,
    ...(server.override ? { override: server.override.path } : {}),
    enabled: server.enabled,
    exposure: server.exposure,
    transport: server.target,
    state: inspection?.state ?? 'disabled',
    tools: (inspection?.tools ?? []).map((tool) => tool.name),
    ...(overrides.length > 0 ? { toolExposure: Object.fromEntries(overrides) } : {}),
    ...(inspection?.error && inspection.state !== 'connected' ? { error: inspection.error } : {}),
  }
}

function stateLabel(entry: ServerReport) {
  if (entry.state === 'connected') {
    return `connected, ${String(entry.tools.length)} tool${entry.tools.length === 1 ? '' : 's'}`
  }
  return entry.state === 'needs-sign-in' ? 'needs sign-in' : entry.state
}

function reportLines(entry: ServerReport, projectOption: string) {
  const tools = entry.tools.map((tool) => {
    const exposure = entry.toolExposure?.[tool]
    return exposure ? `${tool} [${exposure}]` : tool
  })
  return [
    `${entry.name}: ${stateLabel(entry)} (${entry.exposure}, ${entry.scope})`,
    `  ${entry.transport}`,
    ...(entry.override ? [`  override: ${entry.override}`] : []),
    ...(entry.state === 'needs-sign-in'
      ? [`  sign in with: openwaggle mcp login ${entry.name}${projectOption}`]
      : []),
    ...(tools.length > 0 ? [`  tools: ${tools.join(', ')}`] : []),
    ...(entry.error ? [`  ${entry.error.split('\n').join('\n  ')}`] : []),
  ]
}

export async function listCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
  if (args.positional.length > 0)
    throw new McpCliUsageError('Usage: openwaggle mcp list [--json] [-l]')
  const view = await context.host.invoke('mcp:get-configuration', { projectPath })
  const inspections = await inspectEnabledServers(context, projectPath, view.servers)
  const reports = view.servers.map((server) => report(server, inspections.get(server.name)))
  const failed =
    view.errors.length > 0 || reports.some((entry) => entry.enabled && entry.state !== 'connected')
  if (args.flags.has('json')) {
    context.output.log(
      JSON.stringify(
        { servers: reports, errors: view.errors },
        null,
        MCP_CONFIG.JSON_INDENT_SPACES,
      ),
    )
  } else {
    if (reports.length === 0 && view.errors.length === 0) {
      context.output.log('No MCP servers configured. Add one with: openwaggle mcp add')
    }
    const projectOption = projectOptionOf({ args, projectPath })
    for (const entry of reports) context.output.log(reportLines(entry, projectOption).join('\n'))
    for (const error of view.errors) context.output.log(`config error: ${error}`)
  }
  return failed ? MCP_MANAGEMENT_EXIT.FAILURE : MCP_MANAGEMENT_EXIT.SUCCESS
}
