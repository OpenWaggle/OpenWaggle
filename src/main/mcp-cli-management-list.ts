import type {
  McpConfigFileScope,
  McpConfigurationView,
  McpConfiguredServerView,
  McpServerInspection,
} from '@shared/types/mcp-configuration'
import { mcpCliJsonResponse } from './mcp-cli-io'
import { McpCliUsageError } from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementExit,
} from './mcp-cli-management-context'
import { mcpCliShownExposure } from './mcp-cli-management-exposure'
import { inspectEnabledServers } from './mcp-cli-management-inspect'
import {
  MCP_NEEDS_SECRET_HINT,
  MCP_NEEDS_SECRET_STATE,
  mcpCliServerState,
  mcpCliStateLabel,
} from './mcp-cli-management-server-state'

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
  /** What the file says, when OpenWaggle runs it differently (`direct` runs as `codemode`). */
  readonly configuredExposure?: string
  readonly transport: string
  readonly state: string
  readonly tools: readonly string[]
  readonly toolExposure?: Readonly<Record<string, string>>
  readonly error?: string
}

function report(
  server: McpConfiguredServerView,
  inspection: McpServerInspection | undefined,
  view: Pick<McpConfigurationView, 'missingSecretServers'>,
): ServerReport {
  const state = mcpCliServerState(server, inspection, view)
  const exposure = mcpCliShownExposure(server.exposure)
  const overrides = (inspection?.tools ?? []).flatMap((tool) => {
    const toolExposure = mcpCliShownExposure(tool.exposure)
    return toolExposure === exposure ? [] : [[tool.name, toolExposure] as const]
  })
  return {
    name: server.name,
    scope: server.scope,
    source: server.source.path,
    ...(server.override ? { override: server.override.path } : {}),
    enabled: server.enabled,
    exposure,
    ...(exposure === server.exposure ? {} : { configuredExposure: server.exposure }),
    transport: server.target,
    state,
    tools:
      state === MCP_NEEDS_SECRET_STATE ? [] : (inspection?.tools ?? []).map((tool) => tool.name),
    ...(overrides.length > 0 ? { toolExposure: Object.fromEntries(overrides) } : {}),
    ...(inspection?.error && inspection.state !== 'connected' ? { error: inspection.error } : {}),
  }
}

function reportLines(entry: ServerReport, projectOption: string) {
  const tools = entry.tools.map((tool) => {
    const exposure = entry.toolExposure?.[tool]
    return exposure ? `${tool} [${exposure}]` : tool
  })
  return [
    `${entry.name}: ${mcpCliStateLabel(entry.state, entry.tools.length)} (${entry.exposure}, ${entry.scope})`,
    `  ${entry.transport}`,
    ...(entry.override ? [`  override: ${entry.override}`] : []),
    ...(entry.state === 'needs-sign-in'
      ? [`  sign in with: openwaggle mcp login ${entry.name}${projectOption}`]
      : []),
    ...(entry.state === MCP_NEEDS_SECRET_STATE ? [`  ${MCP_NEEDS_SECRET_HINT}`] : []),
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
  const reports = view.servers.map((server) => report(server, inspections.get(server.name), view))
  const failed =
    view.errors.length > 0 || reports.some((entry) => entry.enabled && entry.state !== 'connected')
  if (args.flags.has('json')) {
    context.output.log(mcpCliJsonResponse('list', { servers: reports, errors: view.errors }))
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
