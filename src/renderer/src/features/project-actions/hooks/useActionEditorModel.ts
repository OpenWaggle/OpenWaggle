import type {
  ActionCatalog,
  ActionDefinition,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { actionNameKey } from '@shared/utils/action-name'
import { displayedCommand, invocationFolder } from '../lib/action-draft-edits'
import type { ActionSummaryInput } from '../lib/action-panel-changes'
import { type ActionDraft, draftBaseState } from '../lib/action-panel-drafts'
import { useActionDiscovery } from './useNativeActions'

/** Derived state for the action editor: validation, summary input and whether Save is allowed. */
export function useActionEditorModel(input: {
  readonly scope: ActionManagementScope
  readonly catalog: ActionCatalog
  readonly entry: EffectiveDefinition<ActionDefinition> | undefined
  readonly draft: ActionDraft
}) {
  const discovery = useActionDiscovery(input.scope)
  const definition = input.draft.definition
  const name = definition.name.trim()
  const nameTaken =
    name.length > 0 &&
    input.catalog.actions.some(
      (other) =>
        other.definition.id !== definition.id &&
        actionNameKey(other.definition.name) === actionNameKey(name),
    )
  const command = displayedCommand(definition.invocation, discovery.data)
  const hasSource = definition.invocation.type === 'task' || command.length > 0
  const sharedEdit = input.entry !== undefined && input.entry.source !== 'local'
  const current = draftBaseState(input.draft, input.catalog).kind === 'current'
  const summary: ActionSummaryInput = {
    name: definition.name,
    command: command || '…',
    directory: invocationFolder(definition.invocation),
    kind: definition.kind,
    allowConcurrent: definition.allowConcurrent,
    autoOpenPreview: definition.autoOpenPreview,
    storage: input.draft.storage,
    sharedEdit,
  }
  return {
    name,
    nameTaken,
    hasSource,
    sharedEdit,
    summary,
    canSave: hasSource && name.length > 0 && !nameTaken && current,
  }
}
