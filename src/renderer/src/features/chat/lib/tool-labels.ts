import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import type { JsonObject } from '@shared/types/json'
import { parseMcpToolName } from '@shared/utils/mcp-tool-names'
import { label, stringArg, type ToolLabel, type Verbs, withDetail } from './tool-label-parts'
import { previewLabel } from './tool-labels-browser-preview'
import { type SessionsToolTarget, sessionsLabel } from './tool-labels-sessions'

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

function mcpResourcesLabel(noun: string) {
  return (args: JsonObject) =>
    label({ running: `Listing ${noun}`, done: `Listed ${noun}` }, stringArg(args, 'server'), noun)
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

const DOCS_VERBS: ReadonlyMap<string, Verbs> = new Map(
  Object.entries({
    list: { running: 'Listing OpenWaggle docs', done: 'Listed OpenWaggle docs' },
    search: { running: 'Searching OpenWaggle docs', done: 'Searched OpenWaggle docs' },
    read: { running: 'Reading OpenWaggle docs', done: 'Read OpenWaggle docs' },
  }),
)

function openWaggleDocsLabel(args: JsonObject): ToolLabel {
  const verbs = DOCS_VERBS.get(stringArg(args, 'action') ?? '')
  return label(
    verbs ?? { running: 'OpenWaggle docs', done: 'OpenWaggle docs' },
    stringArg(args, 'topic') ?? stringArg(args, 'query'),
    'OpenWaggle docs',
  )
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

type LabelBuilder = (args: JsonObject) => ToolLabel

/** The goal tools of the pi-goal-x extension. */
function goalLabels(): [string, LabelBuilder][] {
  const goal =
    (running: string, done: string): LabelBuilder =>
    () =>
      label({ running, done }, null, 'goal')
  return [
    ['create_goal', goal('Creating goal', 'Created goal')],
    ['get_goal', goal('Reading goal', 'Read goal')],
    ['update_goal', goal('Updating goal', 'Updated goal')],
    ['set_goal_tasks', goal('Setting goal tasks', 'Set goal tasks')],
    ['update_goal_task', goal('Updating goal task', 'Updated goal task')],
    ['goal_question', goal('Asking about the goal', 'Asked about the goal')],
    ['goal_questionnaire', goal('Asking goal questions', 'Asked goal questions')],
    ['propose_goal_draft', goal('Proposing a goal', 'Proposed a goal')],
  ]
}

const LABELS_BY_TOOL: ReadonlyMap<string, LabelBuilder> = new Map<string, LabelBuilder>([
  ['powershell', shellLabel],
  ['project_actions', projectActionsLabel],
  ['source_control', sourceControlLabel],
  ['openwaggle_docs', openWaggleDocsLabel],
  ...goalLabels(),
  [
    'waggle_invoke',
    (args) =>
      label(
        { running: 'Handing off to Waggle', done: 'Handed off to Waggle' },
        stringArg(args, 'preset'),
        'Waggle handoff',
      ),
  ],
  ['list_mcp_resources', mcpResourcesLabel('MCP resources')],
  ['list_mcp_resource_templates', mcpResourcesLabel('MCP resource templates')],
  [
    'read_mcp_resource',
    (args) =>
      label(
        { running: 'Reading MCP resource', done: 'Read MCP resource' },
        stringArg(args, 'uri'),
        'MCP resource',
        ' ',
      ),
  ],
  [
    'tool_search',
    (args) =>
      label(
        { running: 'Searching tools', done: 'Searched tools' },
        stringArg(args, 'query'),
        'tool search',
      ),
  ],
])

/**
 * Labels for the tools OpenWaggle adds to Pi (sessions, browser preview, project actions…) and
 * for MCP tools. Null for any other tool, which keeps its Pi name.
 */
export function openWaggleToolLabel(
  name: string,
  args: JsonObject,
  sessionTarget: SessionsToolTarget | null = null,
): ToolLabel | null {
  if (name === HIVE_TOOL_NAME) return sessionsLabel(args, sessionTarget)
  const builder = LABELS_BY_TOOL.get(name)
  if (builder) return builder(args)
  return previewLabel(name, args) ?? mcpLabel(name)
}
