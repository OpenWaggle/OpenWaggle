import { safeDecodeUnknown } from '@shared/schema'
import { actionDefinitionSchema } from '@shared/schemas/action-definitions'
import type { ActionDefinition, EffectiveDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useState } from 'react'
import { useChatStore } from '@/features/chat/state'
import { useUIStore } from '@/shell/ui-store'
import { actionDraftProblem } from '../lib/action-draft-problems'
import { type ActionDraft, draftBaseState } from '../lib/action-panel-drafts'
import { useActionPanelStore } from '../state/action-panel-store'
import { useEditActionCatalog, useNativeActions } from './useNativeActions'
import { useRunProjectAction } from './useRunProjectAction'

const CHANGED_WHILE_SAVING =
  'Your actions changed while you were saving. Check the changes above, then save again.'

function saveError(cause: unknown) {
  if (!(cause instanceof Error)) return 'Could not save the action.'
  return cause.message.includes('changed since') ? CHANGED_WHILE_SAVING : cause.message
}

function finalDefinition(draft: ActionDraft) {
  const previewUrl = draft.definition.previewUrl?.trim()
  return safeDecodeUnknown(actionDefinitionSchema, {
    ...draft.definition,
    name: draft.definition.name.trim(),
    previewUrl: previewUrl ? previewUrl : undefined,
    invocation:
      draft.definition.invocation.type === 'command'
        ? { ...draft.definition.invocation, command: draft.definition.invocation.command.trim() }
        : draft.definition.invocation,
  })
}

/**
 * Saving re-reads the catalog first, so a change made meanwhile surfaces as the plain
 * "changed since you started" notice instead of a generic conflict (ADR 0038).
 */
export function useSaveActionDraft(input: {
  readonly scope: ActionManagementScope
  readonly canRun: boolean
  readonly origin: 'session' | 'settings'
}) {
  const catalog = useNativeActions(input.scope)
  const edit = useEditActionCatalog(input.scope)
  const run = useRunProjectAction(input.scope.projectPath)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const store = useActionPanelStore.getState

  /** Run now only in the session it was saved from: the toast can outlive a session switch. */
  function runSaved(saved: ActionDefinition) {
    if (useChatStore.getState().activeSessionId !== input.scope.sessionId) {
      useUIStore
        .getState()
        .showToast('Open the session you saved it from, or run it from + Action.', 'neutral')
      return
    }
    void run(saved)
  }

  function finish(saved: ActionDefinition | null, message: string) {
    store().discardDraft(input.scope.projectPath)
    store().closePanel()
    if (saved && input.origin === 'settings') store().markSaved(input.scope.projectPath, saved.id)
    useUIStore.getState().showActionToast({
      message,
      variant: 'success',
      ...(saved && input.canRun
        ? { action: { label: 'Run now', onClick: () => runSaved(saved) } }
        : {}),
    })
  }

  /**
   * Busy from the pre-save re-read onward, so a double click cannot start two saves. The work
   * returns the plain message to show, or null once it has finished.
   */
  async function exclusive(work: () => Promise<string | null>) {
    if (saving) return
    setSaving(true)
    setError(null)
    let message: string | null
    try {
      message = await work()
    } catch (cause) {
      message = saveError(cause)
    } finally {
      setSaving(false)
    }
    setError(message)
  }

  const save = (draft: ActionDraft) =>
    exclusive(async () => {
      const decoded = finalDefinition(draft)
      if (!decoded.success) {
        return actionDraftProblem(draft.definition)
      }
      const latest = (await catalog.refetch()).data
      if (!latest) throw new Error('Could not read the saved actions. Try again.')
      if (draftBaseState(draft, latest).kind !== 'current') {
        return CHANGED_WHILE_SAVING
      }
      await edit.mutateAsync({
        revision: latest.revision,
        edit: { type: 'save-action', definition: decoded.data, storage: draft.storage },
      })
      finish(decoded.data, `Saved “${decoded.data.name}”.`)
      return null
    })

  const remove = (entry: EffectiveDefinition<ActionDefinition>) =>
    exclusive(async () => {
      const latest = (await catalog.refetch()).data
      if (!latest) throw new Error('Could not read the saved actions. Try again.')
      await edit.mutateAsync({
        revision: latest.revision,
        edit: {
          type: 'delete-action',
          id: entry.definition.id,
          storage: entry.source === 'project' ? 'project' : 'local',
        },
      })
      finish(
        null,
        entry.source === 'override'
          ? `Restored the shared “${entry.definition.name}”.`
          : `Removed “${entry.definition.name}”.`,
      )
      return null
    })

  return { save, remove, error, busy: saving || edit.isPending }
}
