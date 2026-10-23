import type { ScheduledTask } from '@shared/types/scheduled-task'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import {
  type ScheduledTaskEditorTarget,
  useScheduledTaskEditor,
} from '../hooks/useScheduledTaskEditor'
import { nameFromPrompt } from '../lib/task-draft'
import { EditorMoreFields } from './EditorMoreFields'
import { EditorScheduleFields } from './EditorScheduleFields'
import { EditorTargetFields, type ScheduledTaskEditorLayout } from './EditorTargetFields'

const PROMPT_ROWS = 4

function EditorSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

/**
 * Create or edit one Scheduled task in place, in the Right panel or Settings (never a modal).
 * Its order follows what a person decides: what to send, where it runs, when, then the rest.
 */
export function ScheduledTaskEditor({
  target,
  layout,
  onCancel,
  onSaved,
}: {
  readonly target: ScheduledTaskEditorTarget
  readonly layout: ScheduledTaskEditorLayout
  readonly onCancel: () => void
  readonly onSaved: (task: ScheduledTask, created: boolean) => void
}) {
  const editor = useScheduledTaskEditor(target, onSaved)
  const { draft } = editor
  return (
    <form
      aria-label={editor.isEdit ? `Edit ${draft.name}` : 'New Scheduled task'}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        editor.submit()
      }}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <EditorSection title="Prompt">
          <Textarea
            id="scheduled-task-prompt"
            aria-label="Prompt"
            rows={PROMPT_ROWS}
            value={draft.prompt}
            placeholder="What the agent should do each time the task fires"
            onChange={(event) => editor.change({ prompt: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <label htmlFor="scheduled-task-name" className="text-xs text-text-tertiary">
              Name
            </label>
            <TextInput
              id="scheduled-task-name"
              inputSize="sm"
              className="min-w-0 flex-1"
              value={draft.name}
              placeholder={nameFromPrompt(draft.prompt) || 'From the prompt'}
              onChange={(event) => editor.change({ name: event.target.value })}
            />
          </div>
        </EditorSection>
        <EditorSection title="Runs">
          <EditorTargetFields editor={editor} layout={layout} />
        </EditorSection>
        <EditorSection title="When">
          <EditorScheduleFields editor={editor} />
        </EditorSection>
        <EditorMoreFields editor={editor} />
        {editor.error ? (
          <p role="alert" className="rounded-md bg-error/10 px-3 py-2 text-xs text-error-text">
            {editor.error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={editor.isSaving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={editor.isSaving}>
          {editor.isEdit ? 'Save' : 'Create task'}
        </Button>
      </div>
    </form>
  )
}
