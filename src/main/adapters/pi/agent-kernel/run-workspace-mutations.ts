import { isMatching, P } from '@diegogbrisa/ts-match'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import { OPENWAGGLE_DOCS_TOOL_NAME } from '@shared/constants/openwaggle-docs'

/** Tools that never change files, whatever their arguments. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'grep',
  'find',
  'ls',
  OPENWAGGLE_DOCS_TOOL_NAME,
  'preview_status',
  'preview_snapshot',
  'preview_wait_for',
])

/**
 * Tools that change nothing in the workspace for some `action`s only. The hive actions listed read
 * Session state or record Hive metadata; none starts, steers or spawns a Run that could write to a
 * shared Workspace.
 */
const READ_ONLY_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    HIVE_TOOL_NAME,
    new Set([
      'list',
      'search',
      'read',
      'status',
      'queue_list',
      'requests_list',
      'turns',
      'items',
      'wait',
      'delegations_list',
      'delegations_read',
      'delegations_conflicts',
      'agent_definitions_list',
      'agent_definitions_search',
      'report',
      'delegation_state',
      'delegation_submit',
    ]),
  ],
  ['project_actions', new Set(['list', 'discover', 'runs', 'output'])],
  ['source_control', new Set(['status'])],
])

const hasAction = isMatching({ action: P.string })

/**
 * Whether a tool call is known not to change the workspace. Conservative: `write`, `edit`, `bash`,
 * `powershell`, `codemode`, every MCP or extension tool, every unknown tool, and every action not
 * listed above count as possibly mutating.
 */
export function isReadOnlyToolCall(toolName: string, args: unknown): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) return true
  const actions = READ_ONLY_ACTIONS.get(toolName)
  if (!actions || !hasAction(args)) return false
  return actions.has(args.action)
}

/**
 * A prompt that starts with `/` may run an extension command, which can do anything without a
 * tool call (Pi `AgentSession.prompt`).
 */
function mayRunExtensionCommand(promptText: string) {
  return promptText.trimStart().startsWith('/')
}

/**
 * Extensions OpenWaggle runs in process: its own (`<inline:…>`) and Pi's built-in ones
 * (`builtin:…`). Their event handlers change no files. Every other extension is code from disk (a
 * project, user or package extension) whose handlers may do anything.
 */
function isInProcessExtension(extensionPath: string) {
  return extensionPath.startsWith('<inline') || extensionPath.startsWith('builtin:')
}

/**
 * Whether an extension loaded from disk handles any event. Handlers run during a Run without a tool
 * call: a formatter on `agent_end` or a lint gate on `agent_before_settle` can write files, and an
 * `input` handler can turn the prompt into an extension command.
 */
function diskExtensionHandlesEvents(session: Pick<AgentSession, 'resourceLoader'>) {
  return session.resourceLoader
    .getExtensions()
    .extensions.some(
      (extension) =>
        !isInProcessExtension(extension.path) &&
        [...extension.handlers.values()].some((handlers) => handlers.length > 0),
    )
}

export interface RunWorkspaceMutationObserver {
  /** False only when every tool the Run executed is known read-only and nothing else could write. */
  readonly mayHaveChangedWorkspace: () => boolean
  readonly dispose: () => void
}

/**
 * Watches a Run's tool executions, nested ones included, so the turn checkpoint can skip the
 * worktree snapshot for a Run that cannot have changed a file (D11). A Run whose session loaded an
 * extension from disk with event handlers always may have: those run without a tool call.
 */
export function observeRunWorkspaceMutations(
  session: Pick<AgentSession, 'subscribe' | 'resourceLoader'>,
  promptText: string,
): RunWorkspaceMutationObserver {
  let mutated = mayRunExtensionCommand(promptText) || diskExtensionHandlesEvents(session)
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (mutated || event.type !== 'tool_execution_start') return
    if (!isReadOnlyToolCall(event.toolName, event.args)) mutated = true
  })
  return {
    mayHaveChangedWorkspace: () => mutated,
    dispose: unsubscribe,
  }
}
