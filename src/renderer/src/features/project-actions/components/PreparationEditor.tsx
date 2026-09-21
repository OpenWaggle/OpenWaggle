import { safeDecodeUnknown } from '@shared/schema'
import { preparationDefinitionSchema } from '@shared/schemas/action-definitions'
import type {
  ActionCatalog,
  ActionStorage,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useEditActionCatalog } from '../hooks/useNativeActions'
import { ActionDraftRecovery } from './ActionDraftRecovery'
import { ActionInvocationFields } from './ActionInvocationFields'
import { ActionTaskPicker } from './ActionTaskPicker'

export function PreparationEditor(props: {
  readonly scope: ActionManagementScope
  readonly definition: PreparationDefinition
  readonly source: ActionStorage
  readonly catalog: ActionCatalog
  readonly onClose: () => void
}) {
  const title = useId()
  const [draft, setDraft] = useState(props.definition)
  const [storage, setStorage] = useState(props.source)
  const [choosing, setChoosing] = useState(
    !props.definition.invocation ||
      (props.definition.invocation.type === 'command' && !props.definition.invocation.command),
  )
  const [revision, setRevision] = useState(props.catalog.revision)
  const [error, setError] = useState<string | null>(null)
  const mutation = useEditActionCatalog(props.scope)
  async function save() {
    const result = safeDecodeUnknown(preparationDefinitionSchema, draft)
    if (!result.success) {
      setError(result.issues.join('; '))
      return
    }
    try {
      await mutation.mutateAsync({
        revision,
        edit: { type: 'save-preparation', definition: result.data, storage },
      })
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save preparation.')
    }
  }
  return (
    <ModalDialog
      labelledBy={title}
      onClose={props.onClose}
      dismissible={!mutation.isPending}
      className="max-w-xl overflow-hidden"
    >
      <div className="max-h-dvh overflow-y-auto">
        <header className="border-b border-border p-5">
          <h2 id={title} className="text-base font-semibold">
            Workspace {draft.phase}
          </h2>
          <p className="mt-2 text-sm text-text-tertiary">
            {draft.phase === 'setup'
              ? 'Finishes before the first task in a new worktree. Exported variables stay private to that workspace.'
              : 'Runs before the worktree is removed, while its scripts and files are still available.'}
          </p>
        </header>
        {choosing ? (
          <ActionTaskPicker
            scope={props.scope}
            onChoose={(invocation) => {
              setDraft({ ...draft, invocation })
              setChoosing(false)
            }}
          />
        ) : (
          <div className="space-y-4 p-5">
            <ActionInvocationFields
              invocation={draft.invocation}
              onChange={(invocation) => setDraft({ ...draft, invocation })}
              onChangeTask={() => setChoosing(true)}
            />
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs text-text-secondary">Store this definition</legend>
              {(['local', 'project'] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                >
                  <input
                    type="radio"
                    name={`${title}-storage`}
                    checked={storage === value}
                    onChange={() => setStorage(value)}
                  />
                  {value === 'local'
                    ? 'Only on this machine, for this project'
                    : 'In the project · .openwaggle/actions.json'}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        {error ? (
          <ActionDraftRecovery
            scope={props.scope}
            error={error}
            onReload={(value) => {
              setRevision(value)
              setError(null)
            }}
          />
        ) : null}
        <footer className="flex justify-end gap-2 border-t border-border p-5">
          <Button disabled={mutation.isPending} onClick={props.onClose}>
            Cancel
          </Button>
          {!choosing ? (
            <Button variant="primary" disabled={mutation.isPending} onClick={() => void save()}>
              Save {draft.phase}
            </Button>
          ) : null}
        </footer>
      </div>
    </ModalDialog>
  )
}
