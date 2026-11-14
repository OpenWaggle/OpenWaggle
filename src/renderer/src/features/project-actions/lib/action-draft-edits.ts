import type {
  DiscoveredProjectTask,
  ProjectTaskDiscovery,
  ProjectTaskReference,
} from '@shared/types/action-definitions'
import type {
  ActionDraft,
  ActionPanelSource,
  DraftActionDefinition,
  PreparationDraft,
} from './action-panel-drafts'
import {
  scriptCommand,
  suggestActionIcon,
  suggestActionKind,
  suggestActionName,
} from './action-panel-scripts'
import { findDiscoveredTask } from './action-task-availability'

type DraftInvocation = DraftActionDefinition['invocation']

/**
 * Picking a script fills in smart defaults: a readable name, an icon and run behaviour. The name
 * is replaced only while it is still empty or still the previous suggestion, and a saved action's
 * behaviour is never changed by picking a script.
 */
export function applyScriptPick(draft: ActionDraft, reference: ProjectTaskReference) {
  const definition = draft.definition
  const suggestion = suggestActionName(reference)
  const untouched = !definition.name.trim() || definition.name === draft.suggestedName
  const invocation = { type: 'task' as const, task: reference }
  if (!untouched) {
    return { ...draft, definition: { ...definition, invocation } } satisfies ActionDraft
  }
  if (draft.base !== null) {
    return {
      ...draft,
      suggestedName: suggestion,
      definition: { ...definition, invocation, name: suggestion },
    } satisfies ActionDraft
  }
  const kind = suggestActionKind(reference.task)
  return {
    ...draft,
    suggestedName: suggestion,
    definition: {
      ...definition,
      invocation,
      name: suggestion,
      icon: suggestActionIcon(reference.task),
      kind,
      allowConcurrent: false,
      autoOpenPreview: kind === 'service',
    },
  } satisfies ActionDraft
}

/**
 * Choosing "A command I type myself" clears a linked script unless a command is given (such as
 * "Copy it as my own command instead"); choosing scripts keeps any typed text for coming back.
 */
function sourceInvocation(
  invocation: DraftInvocation,
  source: ActionPanelSource,
  command: DraftInvocation | undefined,
) {
  if (command) return command
  const result: DraftInvocation =
    source === 'command' && invocation.type === 'task'
      ? { type: 'command', command: '', directory: '.' }
      : invocation
  return result
}

export function applyActionSource(
  draft: ActionDraft,
  source: ActionPanelSource,
  command?: DraftInvocation,
) {
  const invocation = sourceInvocation(draft.definition.invocation, source, command)
  const result: ActionDraft = { ...draft, source, definition: { ...draft.definition, invocation } }
  return result
}

export function applyPreparationSource(
  draft: PreparationDraft,
  source: ActionPanelSource,
  command?: DraftInvocation,
) {
  const invocation = sourceInvocation(draft.definition.invocation, source, command)
  const result: PreparationDraft = {
    ...draft,
    source,
    definition: { ...draft.definition, invocation },
  }
  return result
}

export function applyPreparationPick(draft: PreparationDraft, task: DiscoveredProjectTask) {
  return {
    ...draft,
    definition: { ...draft.definition, invocation: { type: 'task', task: task.reference } },
  } satisfies PreparationDraft
}

/** What the summary shows as the command; a script falls back to its name until discovery loads. */
export function displayedCommand(
  invocation: DraftInvocation,
  discovery: ProjectTaskDiscovery | undefined,
) {
  if (invocation.type === 'command') return invocation.command.trim()
  const task = findDiscoveredTask(invocation.task, discovery)
  return (task ? scriptCommand(task) : '') || `${invocation.task.task} script`
}

export function invocationFolder(invocation: DraftInvocation) {
  return invocation.type === 'command' ? invocation.directory : invocation.task.directory
}
