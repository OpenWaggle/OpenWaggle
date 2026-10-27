import type { LaunchScheduleWorkspace, ScheduledTaskKind } from '@shared/types/scheduled-task'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { SegmentedRadioGroup } from '@/shared/ui/SegmentedRadioGroup'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import type { ScheduledTaskEditorState } from '../hooks/useScheduledTaskEditor'
import {
  type TargetOption,
  useAgentDefinitionOptions,
  useEnabledModelOptions,
  useHeartbeatSessionOptions,
  useLaunchProjectOptions,
} from '../hooks/useScheduledTaskTargetOptions'
import { EditorField } from './EditorField'

const KIND_OPTIONS: readonly { value: ScheduledTaskKind; label: string }[] = [
  { value: 'heartbeat', label: 'Into a Session' },
  { value: 'launch', label: 'New Session each time' },
]

export type ScheduledTaskEditorLayout = 'narrow' | 'wide'

const WORKSPACE_OPTIONS: readonly { value: LaunchScheduleWorkspace; label: string }[] = [
  { value: 'new-worktree', label: 'New worktree' },
  { value: 'local', label: 'Local checkout' },
]

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value)
}

function OptionList({
  options,
  placeholder,
}: {
  readonly options: readonly TargetOption[]
  readonly placeholder: string
}) {
  return (
    <>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  )
}

function ModelField({
  editor,
  placeholder,
}: {
  readonly editor: ScheduledTaskEditorState
  readonly placeholder: string
}) {
  const models = useEnabledModelOptions(editor.draft.modelId)
  return (
    <EditorField label="Model" htmlFor="scheduled-task-model">
      <Select
        id="scheduled-task-model"
        className="w-full"
        value={editor.draft.modelId}
        onChange={(event) => editor.change({ modelId: event.target.value })}
      >
        <OptionList options={models} placeholder={placeholder} />
      </Select>
    </EditorField>
  )
}

function ThinkingField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  return (
    <EditorField label="Thinking level" htmlFor="scheduled-task-thinking">
      <Select
        id="scheduled-task-thinking"
        className="w-full"
        value={editor.draft.thinkingLevel}
        onChange={(event) => {
          const value = event.target.value
          editor.change({ thinkingLevel: isThinkingLevel(value) ? value : '' })
        }}
      >
        <OptionList
          options={THINKING_LEVELS.map((level) => ({ value: level, label: level }))}
          placeholder="Default"
        />
      </Select>
    </EditorField>
  )
}

function HeartbeatTargetField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const sessions = useHeartbeatSessionOptions(editor.draft.sessionId)
  return (
    <>
      <HeartbeatSessionField editor={editor} sessions={sessions} />
      <div className="grid grid-cols-2 gap-3">
        <ModelField editor={editor} placeholder="The Session’s model" />
        <ThinkingField editor={editor} />
      </div>
      <p className="text-xs text-text-tertiary">
        A cheaper model here applies only to this Heartbeat’s Runs; the Session keeps its own.
      </p>
    </>
  )
}

function HeartbeatSessionField({
  editor,
  sessions,
}: {
  readonly editor: ScheduledTaskEditorState
  readonly sessions: readonly TargetOption[]
}) {
  return (
    <EditorField
      label="Session"
      htmlFor="scheduled-task-session"
      hint={
        editor.isEdit
          ? 'A Heartbeat’s Session cannot change.'
          : 'Sent as a new Run only when the Session is idle. It never steers or queues.'
      }
    >
      <Select
        id="scheduled-task-session"
        className="w-full"
        value={editor.draft.sessionId}
        disabled={editor.isEdit}
        onChange={(event) => editor.change({ sessionId: event.target.value })}
      >
        <OptionList options={sessions} placeholder="Choose a Session…" />
      </Select>
    </EditorField>
  )
}

function LaunchModelFields({
  editor,
  layout,
}: {
  readonly editor: ScheduledTaskEditorState
  readonly layout: ScheduledTaskEditorLayout
}) {
  const definitions = useAgentDefinitionOptions(
    editor.draft.projectPath,
    editor.draft.agentDefinitionName,
  )
  return (
    <div className={layout === 'wide' ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3'}>
      <ModelField editor={editor} placeholder="Project default" />
      <ThinkingField editor={editor} />
      <EditorField label="Agent definition" htmlFor="scheduled-task-agent">
        <Select
          id="scheduled-task-agent"
          className="w-full"
          value={editor.draft.agentDefinitionName}
          onChange={(event) => editor.change({ agentDefinitionName: event.target.value })}
        >
          <OptionList options={definitions} placeholder="None" />
        </Select>
      </EditorField>
    </div>
  )
}

function LaunchTargetFields({
  editor,
  layout,
}: {
  readonly editor: ScheduledTaskEditorState
  readonly layout: ScheduledTaskEditorLayout
}) {
  const projects = useLaunchProjectOptions(editor.draft.projectPath)
  return (
    <>
      <EditorField label="Project" htmlFor="scheduled-task-project">
        <Select
          id="scheduled-task-project"
          className="w-full"
          value={editor.draft.projectPath}
          onChange={(event) => editor.change({ projectPath: event.target.value })}
        >
          <OptionList options={projects} placeholder="Choose a project…" />
        </Select>
      </EditorField>
      <EditorField label="Workspace">
        <SegmentedRadioGroup
          label="Workspace"
          options={WORKSPACE_OPTIONS}
          value={editor.draft.workspace}
          onSelect={(workspace) => editor.change({ workspace })}
        />
      </EditorField>
      <LaunchModelFields editor={editor} layout={layout} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-text-secondary">
          Archive finished runs that need no attention and that no one opened
        </span>
        <ToggleSwitch
          checked={editor.draft.archiveFinishedSessions}
          label="Archive finished runs"
          onCheckedChange={(archiveFinishedSessions) => editor.change({ archiveFinishedSessions })}
        />
      </div>
    </>
  )
}

/** Where the task runs: into an existing Session (Heartbeat) or a new one each time (Launch). */
export function EditorTargetFields({
  editor,
  layout,
}: {
  readonly editor: ScheduledTaskEditorState
  readonly layout: ScheduledTaskEditorLayout
}) {
  return (
    <div className="space-y-3">
      {editor.isEdit ? null : (
        <div>
          <SegmentedRadioGroup
            label="Where it runs"
            options={KIND_OPTIONS}
            value={editor.draft.kind}
            onSelect={editor.changeKind}
          />
        </div>
      )}
      {editor.draft.kind === 'heartbeat' ? (
        <HeartbeatTargetField editor={editor} />
      ) : (
        <LaunchTargetFields editor={editor} layout={layout} />
      )}
    </div>
  )
}
