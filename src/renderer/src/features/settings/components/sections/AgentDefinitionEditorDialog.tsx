import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Textarea } from '@/shared/ui/Textarea'
import {
  AgentDefinitionCapabilityFields,
  AgentDefinitionIdentityFields,
} from './AgentDefinitionEditorFields'
import {
  type AgentDefinitionEditorDialogProps,
  useAgentDefinitionEditor,
} from './use-agent-definition-editor'

export function AgentDefinitionEditorDialog(props: AgentDefinitionEditorDialogProps) {
  const state = useAgentDefinitionEditor(props)
  return (
    <ModalDialog labelledBy="agent-definition-editor-title" onClose={props.onClose}>
      <form
        className="max-h-dvh w-full max-w-2xl space-y-4 overflow-y-auto p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void state.save()
        }}
      >
        <h3 className="text-base font-semibold" id="agent-definition-editor-title">
          {state.title}
        </h3>
        <AgentDefinitionIdentityFields state={state} />
        <AgentDefinitionCapabilityFields state={state} />
        <label className="block space-y-1 text-xs text-text-secondary" htmlFor="agent-instructions">
          Markdown instructions
          <Textarea
            className="min-h-48"
            id="agent-instructions"
            resize="vertical"
            value={state.instructions}
            onChange={(event) => state.setInstructions(event.currentTarget.value)}
          />
        </label>
        {state.error ? (
          <p className="text-xs text-error-text" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button disabled={state.saving} type="button" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={state.saving} type="submit" variant="primary">
            {state.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
