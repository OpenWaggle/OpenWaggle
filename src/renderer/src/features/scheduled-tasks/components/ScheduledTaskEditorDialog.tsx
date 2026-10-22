import type { ScheduledTask } from '@shared/types/scheduled-task'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import {
  type ScheduledTaskEditorTarget,
  useScheduledTaskEditor,
} from '../hooks/useScheduledTaskEditor'
import { EditorField } from './EditorField'
import { EditorLimitsFields } from './EditorLimitsFields'
import { EditorScheduleFields } from './EditorScheduleFields'
import { EditorTargetFields } from './EditorTargetFields'

const TITLE_ID = 'scheduled-task-editor-title'
const PROMPT_ROWS = 5

function EditorSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <fieldset className="space-y-3 border-t border-border pt-4">
      <legend className="pr-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

/** Create or edit one Scheduled task. */
export function ScheduledTaskEditorDialog({
  target,
  onClose,
  onSaved,
}: {
  readonly target: ScheduledTaskEditorTarget
  readonly onClose: () => void
  readonly onSaved?: (task: ScheduledTask, created: boolean) => void
}) {
  const editor = useScheduledTaskEditor(target, (task, created) => {
    onSaved?.(task, created)
    onClose()
  })
  const { draft } = editor

  return (
    <ModalDialog labelledBy={TITLE_ID} onClose={onClose} dismissible={!editor.isSaving}>
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          editor.submit()
        }}
      >
        <h2 id={TITLE_ID} className="text-base font-semibold text-text-primary">
          {editor.isEdit ? 'Edit Scheduled task' : 'New Scheduled task'}
        </h2>
        <EditorField label="Name" htmlFor="scheduled-task-name">
          <TextInput
            id="scheduled-task-name"
            inputSize="sm"
            value={draft.name}
            placeholder="Morning triage"
            onChange={(event) => editor.change({ name: event.target.value })}
          />
        </EditorField>
        <EditorField label="Prompt" htmlFor="scheduled-task-prompt">
          <Textarea
            id="scheduled-task-prompt"
            rows={PROMPT_ROWS}
            value={draft.prompt}
            placeholder="What the agent should do each time the task fires"
            onChange={(event) => editor.change({ prompt: event.target.value })}
          />
        </EditorField>
        <EditorSection title="Target">
          <EditorTargetFields editor={editor} />
        </EditorSection>
        <EditorSection title="Schedule">
          <EditorScheduleFields editor={editor} />
          <EditorLimitsFields editor={editor} />
        </EditorSection>
        {editor.error ? (
          <p role="alert" className="rounded-md bg-error/10 px-3 py-2 text-xs text-error-text">
            {editor.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={editor.isSaving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={editor.isSaving}>
            {editor.isEdit ? 'Save' : 'Create task'}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
