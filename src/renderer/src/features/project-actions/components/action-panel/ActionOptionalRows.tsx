import { useId, useState } from 'react'
import { TextInput } from '@/shared/ui/TextInput'
import {
  capitalized,
  FOLDER_QUESTION,
  folderLabel,
  NEW_STORAGE_COPY,
  PREVIEW_COPY,
  REPEAT_CLICK_COPY,
  RUN_BEHAVIOUR_COPY,
  SHARED_EDIT_STORAGE_COPY,
} from '../../lib/action-panel-copy'
import type { ActionDraft } from '../../lib/action-panel-drafts'
import { ProjectActionIconPicker } from '../ProjectActionIconPicker'
import { ChoiceCards } from './ChoiceCards'
import { OptionalSettingRow, OptionalSettings } from './OptionalSettings'
import { ShortcutSetting, shortcutAnswer } from './ShortcutSetting'

type RowKey = 'kind' | 'again' | 'preview' | 'storage' | 'folder' | 'shortcut' | 'icon'

interface ActionOptionalRowsProps {
  readonly projectPath: string
  readonly draft: ActionDraft
  readonly sharedEdit: boolean
  readonly onChange: (draft: ActionDraft) => void
}

export function ActionOptionalRows(props: ActionOptionalRowsProps) {
  const [open, setOpen] = useState<RowKey | null>(null)
  const { draft } = props
  const definition = draft.definition
  const set = (patch: Partial<ActionDraft['definition']>) =>
    props.onChange({ ...draft, definition: { ...definition, ...patch } })
  const row = (key: RowKey) => ({
    open: open === key,
    onToggle: () => setOpen(open === key ? null : key),
  })
  const storageCopy = props.sharedEdit ? SHARED_EDIT_STORAGE_COPY : NEW_STORAGE_COPY
  const directory =
    definition.invocation.type === 'command'
      ? definition.invocation.directory
      : definition.invocation.task.directory
  return (
    <OptionalSettings>
      <OptionalSettingRow
        question={RUN_BEHAVIOUR_COPY.question}
        answer={RUN_BEHAVIOUR_COPY[definition.kind].short}
        {...row('kind')}
      >
        <ChoiceCards
          label={RUN_BEHAVIOUR_COPY.question}
          value={definition.kind}
          onChange={(kind) =>
            set({
              kind,
              allowConcurrent: false,
              autoOpenPreview: kind === 'service' && definition.autoOpenPreview,
              // The preview row only exists for actions that keep running; don't keep a hidden URL.
              previewUrl: kind === 'service' ? definition.previewUrl : undefined,
            })
          }
          choices={(['task', 'service'] as const).map((value) => ({
            value,
            title: RUN_BEHAVIOUR_COPY[value].title,
            description: RUN_BEHAVIOUR_COPY[value].description,
          }))}
        />
      </OptionalSettingRow>
      {definition.kind === 'task' ? (
        <OptionalSettingRow
          question={REPEAT_CLICK_COPY.question}
          answer={
            definition.allowConcurrent
              ? REPEAT_CLICK_COPY.concurrent.short
              : REPEAT_CLICK_COPY.reuse.short
          }
          {...row('again')}
        >
          <ChoiceCards
            label={REPEAT_CLICK_COPY.question}
            value={definition.allowConcurrent ? 'concurrent' : 'reuse'}
            onChange={(value) => set({ allowConcurrent: value === 'concurrent' })}
            choices={[
              { value: 'reuse', ...REPEAT_CLICK_COPY.reuse, tag: 'Recommended' },
              { value: 'concurrent', ...REPEAT_CLICK_COPY.concurrent },
            ]}
          />
        </OptionalSettingRow>
      ) : (
        <OptionalSettingRow
          question={PREVIEW_COPY.question}
          answer={definition.autoOpenPreview ? PREVIEW_COPY.open.short : PREVIEW_COPY.manual.short}
          {...row('preview')}
        >
          <PreviewChoices draft={draft} onChange={props.onChange} />
        </OptionalSettingRow>
      )}
      <OptionalSettingRow
        question={storageCopy.question}
        answer={storageCopy.options[draft.storage].short}
        {...row('storage')}
      >
        <ChoiceCards
          label={storageCopy.question}
          value={draft.storage}
          onChange={(storage) => props.onChange({ ...draft, storage })}
          choices={(['local', 'project'] as const).map((value) => ({
            value,
            ...storageCopy.options[value],
          }))}
        />
      </OptionalSettingRow>
      <OptionalSettingRow
        question={FOLDER_QUESTION}
        answer={capitalized(folderLabel(directory))}
        {...row('folder')}
      >
        <FolderField
          invocation={definition.invocation}
          onChange={(invocation) => set({ invocation })}
        />
      </OptionalSettingRow>
      <OptionalSettingRow
        question="Keyboard shortcut"
        answer={shortcutAnswer(definition.shortcutRules)}
        {...row('shortcut')}
      >
        <ShortcutSetting
          projectPath={props.projectPath}
          actionId={definition.id}
          rules={definition.shortcutRules}
          onChange={(shortcutRules) => set({ shortcutRules })}
        />
      </OptionalSettingRow>
      <OptionalSettingRow
        question="Icon in the + Action menu"
        answer={`${capitalized(definition.icon)}. Only changes how it looks.`}
        {...row('icon')}
      >
        <p className="text-sm leading-6 text-text-tertiary">
          The icon is only a visual hint in the menu. It does not change how the action runs.
        </p>
        <ProjectActionIconPicker selected={definition.icon} onSelect={(icon) => set({ icon })} />
      </OptionalSettingRow>
    </OptionalSettings>
  )
}

function PreviewChoices(props: {
  readonly draft: ActionDraft
  readonly onChange: (draft: ActionDraft) => void
}) {
  const id = useId()
  const definition = props.draft.definition
  const set = (patch: Partial<ActionDraft['definition']>) =>
    props.onChange({ ...props.draft, definition: { ...definition, ...patch } })
  return (
    <>
      <ChoiceCards
        label={PREVIEW_COPY.question}
        value={definition.autoOpenPreview ? 'open' : 'manual'}
        onChange={(value) => set({ autoOpenPreview: value === 'open' })}
        choices={[
          { value: 'open', ...PREVIEW_COPY.open },
          { value: 'manual', ...PREVIEW_COPY.manual },
        ]}
      />
      <label htmlFor={id} className="text-sm text-text-tertiary">
        {PREVIEW_COPY.urlLabel}
      </label>
      <TextInput
        id={id}
        value={definition.previewUrl ?? ''}
        placeholder="http://localhost:5173"
        onChange={(event) => set({ previewUrl: event.target.value || undefined })}
      />
    </>
  )
}

type DraftInvocation = ActionDraft['definition']['invocation']

export function FolderField(props: {
  readonly invocation: DraftInvocation
  readonly onChange: (invocation: DraftInvocation) => void
}) {
  const id = useId()
  const { invocation } = props
  if (invocation.type === 'task')
    return (
      <p className="text-sm leading-6 text-text-tertiary">
        Scripts always run in their own package folder:{' '}
        <code className="font-mono text-text-secondary">{invocation.task.directory}</code>.
      </p>
    )
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Folder
      </label>
      <TextInput
        id={id}
        monospace
        value={invocation.directory}
        placeholder="."
        onChange={(event) => props.onChange({ ...invocation, directory: event.target.value })}
      />
      <p className="text-sm leading-6 text-text-tertiary">
        Relative to the project. Leave <code className="font-mono">.</code> for the project folder.
        In a worktree session, this is that worktree.
      </p>
    </>
  )
}
