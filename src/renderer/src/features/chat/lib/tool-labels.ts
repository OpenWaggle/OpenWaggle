import type { JsonObject } from '@shared/types/json'
import { parseMcpToolName } from './tool-kind'
import { label, stringArg, type ToolLabel, type Verbs, withDetail } from './tool-label-parts'
import { previewLabel } from './tool-labels-browser-preview'
import { sessionsLabel } from './tool-labels-sessions'

/** An MCP server's Pi namespace as a name, such as `chrome_devtools` to `Chrome devtools`. */
function mcpServerName(namespace: string) {
  const words = namespace.replace(/_+/g, ' ').trim()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : namespace
}

/** `mcp__<namespace>__<tool>` as `Server › tool`. */
function mcpToolTitle(name: string) {
  const parsed = parseMcpToolName(name)
  return parsed ? `${mcpServerName(parsed.server)} › ${parsed.tool}` : null
}

function mcpResourceLabel(name: string, args: JsonObject): ToolLabel | null {
  if (name === 'list_mcp_resources' || name === 'list_mcp_resource_templates') {
    const noun = name === 'list_mcp_resources' ? 'MCP resources' : 'MCP resource templates'
    return label(
      { running: `Listing ${noun}`, done: `Listed ${noun}` },
      stringArg(args, 'server'),
      noun,
    )
  }
  if (name === 'read_mcp_resource') {
    return label(
      { running: 'Reading MCP resource', done: 'Read MCP resource' },
      stringArg(args, 'uri'),
      'MCP resource',
      ' ',
    )
  }
  if (name === 'tool_search') {
    return label(
      { running: 'Searching tools', done: 'Searched tools' },
      stringArg(args, 'query'),
      'tool search',
    )
  }
  return null
}

function mcpLabel(name: string): ToolLabel | null {
  const title = mcpToolTitle(name)
  return title ? { running: `${title}...`, done: title, requested: `Requested ${title}` } : null
}

const PROJECT_ACTION_VERBS: ReadonlyMap<string, Verbs> = new Map(
  Object.entries({
    list: { running: 'Listing project actions', done: 'Listed project actions' },
    discover: { running: 'Discovering project tasks', done: 'Discovered project tasks' },
    runs: { running: 'Listing action runs', done: 'Listed action runs' },
    start: { running: 'Starting project action', done: 'Started project action' },
    output: { running: 'Reading action output', done: 'Read action output' },
    stop: { running: 'Stopping project action', done: 'Stopped project action' },
    propose: { running: 'Proposing command fix', done: 'Proposed command fix' },
  }),
)

function projectActionsLabel(args: JsonObject): ToolLabel {
  const action = stringArg(args, 'action') ?? ''
  const verbs = PROJECT_ACTION_VERBS.get(action)
  return label(
    verbs ?? { running: 'Project actions', done: 'Project actions' },
    stringArg(args, 'actionId') ?? (verbs ? null : action || null),
    'project action',
  )
}

function sourceControlLabel(args: JsonObject): ToolLabel {
  const verbs =
    stringArg(args, 'action') === 'configure'
      ? { running: 'Configuring source control', done: 'Configured source control' }
      : { running: 'Checking source control', done: 'Checked source control' }
  return label(verbs, stringArg(args, 'change'), 'source control')
}

function shellLabel(args: JsonObject): ToolLabel {
  const command = stringArg(args, 'command')
  const quoted = command ? `\`${command}\`` : null
  return {
    running: quoted ? `Running ${quoted}` : 'Running...',
    done: withDetail('Ran', quoted, ' '),
    requested: withDetail('Requested powershell', quoted, ' '),
  }
}

/**
 * Labels for the tools OpenWaggle adds to Pi (sessions, browser preview, project actions…) and
 * for MCP tools. Null for any other tool, which keeps its Pi name.
 */
export function openWaggleToolLabel(name: string, args: JsonObject): ToolLabel | null {
  if (name === 'sessions') return sessionsLabel(args)
  if (name === 'powershell') return shellLabel(args)
  if (name === 'project_actions') return projectActionsLabel(args)
  if (name === 'source_control') return sourceControlLabel(args)
  if (name === 'create_goal') {
    return label({ running: 'Creating goal', done: 'Created goal' }, null, 'goal')
  }
  if (name === 'get_goal') {
    return label({ running: 'Reading goal', done: 'Read goal' }, null, 'goal')
  }
  if (name === 'waggle_invoke') {
    return label(
      { running: 'Handing off to Waggle', done: 'Handed off to Waggle' },
      stringArg(args, 'preset'),
      'Waggle handoff',
    )
  }
  return mcpResourceLabel(name, args) ?? previewLabel(name, args) ?? mcpLabel(name)
}
