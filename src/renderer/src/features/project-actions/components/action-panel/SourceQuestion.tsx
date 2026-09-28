import type {
  ActionInvocation,
  DiscoveredProjectTask,
  ProjectTaskDiscovery,
} from '@shared/types/action-definitions'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { Link2 } from 'lucide-react'
import { useEffect, useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { useActionDiscovery } from '../../hooks/useNativeActions'
import type { ActionPanelSource, DraftActionDefinition } from '../../lib/action-panel-drafts'
import { scriptCommand, taskReferenceKey } from '../../lib/action-panel-scripts'
import { findDiscoveredTask } from '../../lib/action-task-availability'
import { useActionPanelStore } from '../../state/action-panel-store'
import { ChoiceCards } from './ChoiceCards'
import { ScriptPicker } from './ScriptPicker'

const COMMAND_ROWS = 3
type DraftInvocation = DraftActionDefinition['invocation']

export interface SourceQuestionProps {
  readonly scope: ActionManagementScope
  readonly source: ActionPanelSource
  readonly invocation: DraftInvocation
  /** A command given with the source replaces the invocation in the same change. */
  readonly onSourceChange: (source: ActionPanelSource, command?: DraftInvocation) => void
  readonly onPick: (task: DiscoveredProjectTask) => void
  readonly onInvocationChange: (invocation: DraftInvocation) => void
}

function discoveryStatus(query: ReturnType<typeof useActionDiscovery>) {
  if (query.isPending) return 'loading' as const
  return query.error ? ('error' as const) : ('ready' as const)
}

/** A complete discovery that does not contain the linked script proves it is missing here. */
function linkedScriptMissing(
  invocation: DraftInvocation,
  discovery: ProjectTaskDiscovery | undefined,
) {
  if (invocation.type !== 'task' || !discovery) return false
  if (findDiscoveredTask(invocation.task, discovery)) return false
  return (
    discovery.tasks.length < ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS &&
    discovery.diagnostics.length === 0
  )
}

function sourceChoices(tasks: readonly DiscoveredProjectTask[]) {
  const example = tasks[0]?.reference.task
  return [
    {
      value: 'script' as const,
      title: 'A script from this project',
      description: example
        ? `OpenWaggle found ${String(tasks.length)} scripts in this project, like ${example}.`
        : 'Scripts from package.json, pyproject.toml or Cargo aliases.',
      ...(example ? { tag: 'Recommended' } : {}),
    },
    {
      value: 'command' as const,
      title: 'A command I type myself',
      description: 'Anything you would type in a terminal.',
    },
  ]
}

/** "What should it run?": a project script (recommended) or the user's own command. */
export function SourceQuestion(props: SourceQuestionProps) {
  const discovery = useActionDiscovery(props.scope)
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3.5">
      <ChoiceCards
        label="What should it run?"
        value={props.source}
        onChange={(source) => props.onSourceChange(source)}
        choices={sourceChoices(discovery.data?.tasks ?? [])}
      />
      {props.source === 'script' ? (
        <ScriptSource {...props} discovery={discovery} />
      ) : (
        <CommandField invocation={props.invocation} onChange={props.onInvocationChange} />
      )}
    </div>
  )
}

function ScriptSource(
  props: SourceQuestionProps & { readonly discovery: ReturnType<typeof useActionDiscovery> },
) {
  const { discovery, invocation } = props
  const linked =
    invocation.type === 'task' ? findDiscoveredTask(invocation.task, discovery.data) : undefined
  const rememberScriptCommand = useActionPanelStore((state) => state.rememberScriptCommand)
  const linkedCommand = linked ? scriptCommand(linked) : ''
  const linkedKey = invocation.type === 'task' ? taskReferenceKey(invocation.task) : null
  useEffect(() => {
    if (linkedKey && linkedCommand) rememberScriptCommand(linkedKey, linkedCommand)
  }, [linkedCommand, linkedKey, rememberScriptCommand])
  return (
    <>
      <ScriptPicker
        tasks={discovery.data?.tasks ?? []}
        selected={invocation.type === 'task' ? invocation.task : null}
        status={discoveryStatus(discovery)}
        onPick={props.onPick}
        onRetry={() => void discovery.refetch()}
      />
      {invocation.type === 'task' && linkedScriptMissing(invocation, discovery.data) ? (
        <MissingScriptNotice {...props} invocation={invocation} />
      ) : null}
      {invocation.type === 'task' && linked ? (
        <LinkedScriptNote
          invocation={invocation}
          command={linkedCommand}
          onCopy={() =>
            props.onSourceChange('command', {
              type: 'command',
              command: linkedCommand,
              directory: linked.reference.directory,
            })
          }
        />
      ) : null}
    </>
  )
}

function LinkedScriptNote(props: {
  readonly invocation: Extract<ActionInvocation, { type: 'task' }>
  readonly command: string
  readonly onCopy: () => void
}) {
  const { task } = props.invocation
  return (
    <div className="flex items-start gap-2.5 text-sm leading-6 text-text-tertiary">
      <Link2 aria-hidden className="mt-1 size-4 shrink-0" />
      <p className="min-w-0">
        {props.command ? (
          <>
            Runs <code className="break-all font-mono text-text-secondary">{props.command}</code>.{' '}
          </>
        ) : null}
        Linked to the <code className="font-mono text-text-secondary">{task.task}</code> script in{' '}
        <code className="font-mono text-text-secondary">{task.source}</code>. If someone changes
        that script, this action follows automatically.{' '}
        <Button variant="link" size="none" className="inline" onClick={props.onCopy}>
          Copy it as my own command instead
        </Button>
      </p>
    </div>
  )
}

function MissingScriptNotice(
  props: SourceQuestionProps & { readonly invocation: Extract<ActionInvocation, { type: 'task' }> },
) {
  const { task } = props.invocation
  const lastKnown = useActionPanelStore(
    (state) => state.lastSeenScriptCommands[taskReferenceKey(task)] ?? null,
  )
  return (
    <div
      role="status"
      className="grid gap-3 rounded-xl border border-border-light bg-bg px-4 py-3.5"
    >
      <p className="text-sm leading-6 text-text-secondary">
        The <code className="font-mono">{task.task}</code> script isn’t in this workspace’s{' '}
        <code className="font-mono">{task.source}</code>, so this action can’t run here. It still
        works where the script exists. Nothing changes unless you choose.
      </p>
      <p className="text-sm text-text-tertiary">
        Keeping it linked is fine. You can also pick another script above
        {lastKnown ? ', or use the command it last ran:' : '.'}
      </p>
      {lastKnown ? (
        <Button
          variant="secondary"
          className="justify-self-start"
          onClick={() =>
            props.onSourceChange('command', {
              type: 'command',
              command: lastKnown,
              directory: task.directory,
            })
          }
        >
          Use the last known command instead
        </Button>
      ) : null}
    </div>
  )
}

const REMOVED_VARIABLES = /T3CODE_(PROJECT_ROOT|WORKTREE_PATH)/

function CommandField(props: {
  readonly invocation: DraftInvocation
  readonly onChange: (invocation: DraftInvocation) => void
}) {
  const id = useId()
  const command = props.invocation.type === 'command' ? props.invocation.command : ''
  const directory =
    props.invocation.type === 'command'
      ? props.invocation.directory
      : props.invocation.task.directory
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="sr-only">
        Command
      </label>
      <Textarea
        id={id}
        variant="mono"
        rows={COMMAND_ROWS}
        className="text-sm"
        value={command}
        placeholder="For example: pnpm dev"
        onChange={(event) =>
          props.onChange({ type: 'command', command: event.target.value, directory })
        }
      />
      <p className="text-sm leading-6 text-text-tertiary">
        It runs in your shell, exactly as if you typed it in a terminal. It can use{' '}
        <code className="font-mono">$OPENWAGGLE_PROJECT_ROOT</code> and{' '}
        <code className="font-mono">$OPENWAGGLE_WORKTREE_PATH</code>.
      </p>
      {REMOVED_VARIABLES.test(command) ? (
        <div
          role="status"
          className="grid gap-2 rounded-xl border border-border-light p-3.5 text-sm"
        >
          <p className="leading-6 text-text-secondary">
            This command uses variable names from an older integration that no longer exist. Replace
            them with OpenWaggle’s names?
          </p>
          <Button
            variant="secondary"
            className="justify-self-start"
            onClick={() =>
              props.onChange({
                type: 'command',
                directory,
                command: command
                  .replaceAll('T3CODE_PROJECT_ROOT', 'OPENWAGGLE_PROJECT_ROOT')
                  .replaceAll('T3CODE_WORKTREE_PATH', 'OPENWAGGLE_WORKTREE_PATH'),
              })
            }
          >
            Replace the variable names
          </Button>
        </div>
      ) : null}
    </div>
  )
}
