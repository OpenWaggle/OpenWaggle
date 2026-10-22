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
  { value: 'heartbeat', label: 'Heartbeat' },
  { value: 'launch', label: 'Launch schedule' },
]

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

function HeartbeatTargetField({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const sessions = useHeartbeatSessionOptions(editor.draft.sessionId)
  return (
    <EditorField
      label="Session"
      htmlFor="scheduled-task-session"
      hint={editor.isEdit ? 'A Heartbeat’s Session cannot change.' : undefined}
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

function LaunchModelFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  const models = useEnabledModelOptions(editor.draft.modelId)
  const definitions = useAgentDefinitionOptions(
    editor.draft.projectPath,
    editor.draft.agentDefinitionName,
  )
  return (
    <div className="grid grid-cols-3 gap-3">
      <EditorField label="Model" htmlFor="scheduled-task-model">
        <Select
          id="scheduled-task-model"
          className="w-full"
          value={editor.draft.modelId}
          onChange={(event) => editor.change({ modelId: event.target.value })}
        >
          <OptionList options={models} placeholder="Project default" />
        </Select>
      </EditorField>
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

function LaunchTargetFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
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
      <LaunchModelFields editor={editor} />
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

/** What the task fires into: an existing Session (Heartbeat) or a new one per run (Launch). */
export function EditorTargetFields({ editor }: { readonly editor: ScheduledTaskEditorState }) {
  return (
    <div className="space-y-3">
      {editor.isEdit ? null : (
        <EditorField label="Kind">
          <SegmentedRadioGroup
            label="Kind"
            options={KIND_OPTIONS}
            value={editor.draft.kind}
            onSelect={editor.changeKind}
          />
        </EditorField>
      )}
      {editor.draft.kind === 'heartbeat' ? (
        <HeartbeatTargetField editor={editor} />
      ) : (
        <LaunchTargetFields editor={editor} />
      )}
    </div>
  )
}
