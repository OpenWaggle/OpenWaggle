import { safeDecodeUnknown } from '@shared/schema'
import { actionDefinitionSchema } from '@shared/schemas/action-definitions'
import type {
  ActionDefinition,
  ActionStorage,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { ArrowLeft } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useEditActionCatalog } from '../hooks/useNativeActions'
import { ActionDraftRecovery } from './ActionDraftRecovery'
import { ActionEditorHeading } from './ActionEditorHeading'
import { ActionTaskPicker } from './ActionTaskPicker'
import { NativeActionFields } from './NativeActionFields'

export function NativeActionEditor(props: {
  readonly scope: ActionManagementScope
  readonly entry: EffectiveDefinition<ActionDefinition> | null
  readonly revision: string
  readonly onClose: () => void
}) {
  const headingId = useId()
  const [step, setStep] = useState<'choose' | 'configure'>(props.entry ? 'configure' : 'choose')
  const [draft, setDraft] = useState<ActionDefinition>(
    () =>
      props.entry?.definition ?? {
        id: crypto.randomUUID(),
        name: '',
        icon: 'play',
        invocation: { type: 'command', command: '', directory: '.' },
        kind: 'task',
        allowConcurrent: false,
        autoOpenPreview: false,
      },
  )
  const [storage, setStorage] = useState<ActionStorage>(
    props.entry?.source === 'project' ? 'project' : 'local',
  )
  const revision = useRef(props.revision)
  const [error, setError] = useState<string | null>(null)
  const save = useEditActionCatalog(props.scope)
  async function submit() {
    const decoded = safeDecodeUnknown(actionDefinitionSchema, { ...draft, name: draft.name.trim() })
    if (!decoded.success) {
      setError(decoded.issues.join('; '))
      return
    }
    try {
      await save.mutateAsync({
        revision: revision.current,
        edit: { type: 'save-action', definition: decoded.data, storage },
      })
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save action.')
    }
  }
  return (
    <ModalDialog
      labelledBy={headingId}
      onClose={props.onClose}
      dismissible={!save.isPending}
      className="max-w-xl overflow-hidden"
    >
      <form
        className="flex max-h-dvh flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <ActionEditorHeading
          id={headingId}
          choosing={step === 'choose'}
          editing={Boolean(props.entry)}
          busy={save.isPending}
          onClose={props.onClose}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 'choose' ? (
            <ActionTaskPicker
              scope={props.scope}
              onChoose={(invocation, name) => {
                setDraft((current) => ({ ...current, invocation, name: current.name || name }))
                setStep('configure')
              }}
            />
          ) : (
            <NativeActionFields
              action={draft}
              storage={storage}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onStorageChange={setStorage}
              onChangeTask={() => setStep('choose')}
            />
          )}
        </div>
        {error ? (
          <ActionDraftRecovery
            scope={props.scope}
            error={error}
            onReload={(value) => {
              revision.current = value
              setError(null)
            }}
          />
        ) : null}
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          {step === 'configure' ? (
            <Button variant="ghost" disabled={save.isPending} onClick={() => setStep('choose')}>
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : (
            <span className="text-xs text-text-tertiary">Nothing runs until you start it.</span>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={save.isPending} onClick={props.onClose}>
              Cancel
            </Button>
            {step === 'configure' ? (
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save action'}
              </Button>
            ) : null}
          </div>
        </footer>
      </form>
    </ModalDialog>
  )
}
