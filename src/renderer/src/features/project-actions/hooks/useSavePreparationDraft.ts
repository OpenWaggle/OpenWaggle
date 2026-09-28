import { safeDecodeUnknown } from '@shared/schema'
import { preparationDefinitionSchema } from '@shared/schemas/action-definitions'
import type { EffectiveDefinition, PreparationDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useRef, useState } from 'react'
import { useUIStore } from '@/shell/ui-store'
import { preparationDraftProblem } from '../lib/action-draft-problems'
import { draftBaseState, type PreparationDraft } from '../lib/action-panel-drafts'
import { useActionPanelStore } from '../state/action-panel-store'
import { useEditActionCatalog, useNativeActions } from './useNativeActions'

const CHANGED_WHILE_SAVING =
  'Your setup changed while you were saving. Check the changes above, then save again.'

function saveError(cause: unknown) {
  if (!(cause instanceof Error)) return 'Could not save.'
  return cause.message.includes('changed since') ? CHANGED_WHILE_SAVING : cause.message
}

function phaseNoun(phase: PreparationDefinition['phase']) {
  return phase === 'setup' ? 'worktree setup' : 'worktree cleanup'
}

export function useSavePreparationDraft(scope: ActionManagementScope) {
  const catalog = useNativeActions(scope)
  const edit = useEditActionCatalog(scope)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  function finish(message: string) {
    const store = useActionPanelStore.getState()
    store.discardDraft(scope.projectPath)
    store.closePanel()
    useUIStore.getState().showToast(message, 'success')
  }

  async function latestCatalog() {
    const latest = (await catalog.refetch()).data
    if (!latest) throw new Error('Could not read the saved setup. Try again.')
    return latest
  }

  /**
   * Busy from the pre-save re-read onward, so a double click cannot start two saves. The work
   * returns the plain message to show, or null once it has finished.
   */
  async function exclusive(work: () => Promise<string | null>) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    let message: string | null
    try {
      message = await work()
    } catch (cause) {
      message = saveError(cause)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
    setError(message)
  }

  const save = (draft: PreparationDraft) =>
    exclusive(async () => {
      const invocation = draft.definition.invocation
      const decoded = safeDecodeUnknown(preparationDefinitionSchema, {
        ...draft.definition,
        invocation:
          invocation.type === 'command'
            ? { ...invocation, command: invocation.command.trim() }
            : invocation,
      })
      if (!decoded.success) {
        return preparationDraftProblem(draft.definition, decoded.issues)
      }
      const latest = await latestCatalog()
      if (draftBaseState(draft, latest).kind !== 'current') {
        return CHANGED_WHILE_SAVING
      }
      await edit.mutateAsync({
        revision: latest.revision,
        edit: { type: 'save-preparation', definition: decoded.data, storage: draft.storage },
      })
      finish(`Saved your ${phaseNoun(decoded.data.phase)}.`)
      return null
    })

  const remove = (entry: EffectiveDefinition<PreparationDefinition>) =>
    exclusive(async () => {
      const latest = await latestCatalog()
      await edit.mutateAsync({
        revision: latest.revision,
        edit: {
          type: 'delete-preparation',
          id: entry.definition.id,
          storage: entry.source === 'project' ? 'project' : 'local',
        },
      })
      finish(
        entry.source === 'override'
          ? `Restored the shared ${phaseNoun(entry.definition.phase)}.`
          : `Removed your ${phaseNoun(entry.definition.phase)}.`,
      )
      return null
    })

  return { save, remove, error, busy: saving || edit.isPending }
}
