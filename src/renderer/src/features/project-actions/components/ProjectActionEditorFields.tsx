import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import { Plus, X } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import {
  PROJECT_ACTION_WHEN_VARIABLES,
  type ProjectActionDraft,
  type ProjectActionShortcutRuleDraft,
} from '../lib/project-action-model'
import { ProjectActionConditionBuilder } from './ProjectActionConditionBuilder'
import { ProjectActionIconPicker } from './ProjectActionIconPicker'

const COMMAND_TEXTAREA_ROWS = 3

export interface ProjectActionShortcutEditor {
  readonly conflictLabels: readonly (readonly string[])[]
  readonly ruleLimit: number
  readonly unknownWhenVariables: readonly (readonly string[])[]
  readonly onAdd: () => void
  readonly onChange: (index: number, patch: Partial<ProjectActionShortcutRuleDraft>) => void
  readonly onRemove: (index: number) => void
  readonly onKeyDown: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void
}

interface ProjectActionEditorFieldsProps {
  readonly draft: ProjectActionDraft
  readonly shortcutEditor: ProjectActionShortcutEditor
  readonly onChange: (patch: Partial<ProjectActionDraft>) => void
}

function FieldLabel({
  htmlFor,
  children,
}: {
  readonly htmlFor: string
  readonly children: ReactNode
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-text-secondary">
      {children}
    </label>
  )
}

function ToggleRow(props: {
  readonly checked: boolean
  readonly label: string
  readonly description: string
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-bg px-3 py-2.5">
      <div>
        <p className="text-xs font-medium text-text-primary">{props.label}</p>
        <p className="mt-0.5 text-xs text-text-tertiary">{props.description}</p>
      </div>
      <ToggleSwitch
        checked={props.checked}
        disabled={props.disabled}
        label={props.label}
        onCheckedChange={props.onChange}
      />
    </div>
  )
}

function ProjectActionShortcutRuleField(props: {
  readonly index: number
  readonly rule: ProjectActionShortcutRuleDraft
  readonly editor: ProjectActionShortcutEditor
}) {
  const bindingNumber = props.index + 1
  const conflicts = props.editor.conflictLabels[props.index] ?? []
  const unknownVariables = props.editor.unknownWhenVariables[props.index] ?? []
  const disabled = props.index >= props.editor.ruleLimit

  return (
    <div className="space-y-3 rounded-md border border-border bg-bg px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-secondary">
          Binding {String(bindingNumber)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove binding ${String(bindingNumber)}`}
          onClick={() => props.editor.onRemove(props.index)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <Button
        type="button"
        variant="unstyled"
        aria-label={`Record binding ${String(bindingNumber)}`}
        data-project-action-shortcut-input=""
        disabled={disabled}
        onKeyDown={(event) => props.editor.onKeyDown(props.index, event)}
        className="w-full justify-center rounded-md border border-border-light bg-bg px-3 py-2 font-mono text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {props.rule.shortcut === null
          ? 'Press a shortcut'
          : formatShortcutBinding(props.rule.shortcut)}
      </Button>
      <p className="text-xs text-text-muted">Press Backspace or Delete to clear.</p>
      <ProjectActionConditionBuilder
        value={props.rule.when}
        expressionLabel={`Condition for binding ${String(bindingNumber)}`}
        onChange={(when) => props.editor.onChange(props.index, { when })}
      />
      {conflicts.length > 0 ? (
        <p className="text-xs text-warning">
          May overlap {conflicts.map((label) => `“${label}”`).join(', ')}. The most recent active
          binding wins.
        </p>
      ) : null}
      {unknownVariables.length > 0 ? (
        <p className="text-xs text-warning">
          Unknown context {unknownVariables.map((name) => `“${name}”`).join(', ')} evaluates to
          false unless the runtime provides it.
        </p>
      ) : null}
    </div>
  )
}

function ProjectActionShortcutFields(props: {
  readonly draft: ProjectActionDraft
  readonly editor: ProjectActionShortcutEditor
}) {
  const bindingCount = props.draft.shortcutRules.filter((rule) => rule.shortcut !== null).length
  const canAdd = props.draft.shortcutRules.length < props.editor.ruleLimit

  return (
    <fieldset className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <legend className="text-xs font-medium text-text-secondary">Keyboard bindings</legend>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Ordered rules support the same contextual <code>when</code> expressions as T3.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={!canAdd}
          onClick={props.editor.onAdd}
        >
          <Plus className="size-3" />
          Add binding
        </Button>
      </div>
      {props.draft.shortcutRules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-text-muted">
          No keyboard bindings. Add one to run this action without opening the menu.
        </p>
      ) : (
        props.draft.shortcutRules.map((rule, index) => (
          <ProjectActionShortcutRuleField
            key={rule.draftKey}
            index={index}
            rule={rule}
            editor={props.editor}
          />
        ))
      )}
      <p className="text-xs text-text-muted">
        {String(bindingCount)} of {String(PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT)} project
        bindings used.
      </p>
      <p className="text-xs text-text-muted">
        Contexts: {PROJECT_ACTION_WHEN_VARIABLES.join(', ')}
      </p>
    </fieldset>
  )
}

export function ProjectActionEditorFields(props: ProjectActionEditorFieldsProps) {
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="project-action-name">Name</FieldLabel>
        <TextInput
          id="project-action-name"
          autoFocus
          value={props.draft.name}
          maxLength={PROJECT_ACTION_LIMITS.NAME_LENGTH}
          placeholder="Run tests"
          onChange={(event) => props.onChange({ name: event.currentTarget.value })}
        />
      </div>
      <ProjectActionIconPicker
        selected={props.draft.icon}
        onSelect={(icon) => props.onChange({ icon })}
      />
      <ProjectActionShortcutFields draft={props.draft} editor={props.shortcutEditor} />
      <div>
        <FieldLabel htmlFor="project-action-command">Command</FieldLabel>
        <Textarea
          id="project-action-command"
          aria-label="Command"
          rows={COMMAND_TEXTAREA_ROWS}
          variant="mono"
          maxLength={PROJECT_ACTION_LIMITS.COMMAND_LENGTH}
          value={props.draft.command}
          placeholder="pnpm test"
          onChange={(event) => props.onChange({ command: event.currentTarget.value })}
        />
      </div>
      <div>
        <FieldLabel htmlFor="project-action-preview-url">Preview URL (optional)</FieldLabel>
        <TextInput
          id="project-action-preview-url"
          type="text"
          value={props.draft.previewUrl}
          maxLength={PROJECT_ACTION_LIMITS.PREVIEW_URL_LENGTH}
          placeholder="http://localhost:5173"
          onChange={(event) => props.onChange({ previewUrl: event.currentTarget.value })}
        />
      </div>
      <ToggleRow
        checked={props.draft.runOnWorktreeCreate}
        label="Run on Session Worktree creation"
        description="Start this command once when a new Session Working path is created."
        onChange={(runOnWorktreeCreate) => props.onChange({ runOnWorktreeCreate })}
      />
      <ToggleRow
        checked={props.draft.autoOpenPreview}
        label="Open preview automatically"
        description="Open the preview after the command starts."
        disabled={props.draft.previewUrl.trim().length === 0}
        onChange={(autoOpenPreview) => props.onChange({ autoOpenPreview })}
      />
    </div>
  )
}
