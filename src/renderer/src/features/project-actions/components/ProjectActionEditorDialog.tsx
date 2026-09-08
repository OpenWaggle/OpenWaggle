import {
  PROJECT_ACTION_LIMITS,
  type ProjectAction,
  type ProjectActionInput,
} from '@shared/types/project-actions'
import { projectActionShortcutRules } from '@shared/utils/project-action-shortcuts'
import { type KeyboardEvent, type SubmitEvent, useId, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import {
  type BuiltInShortcutSource,
  emptyProjectActionShortcutRuleDraft,
  type ProjectActionDraft,
  type ProjectActionShortcutRuleDraft,
  projectActionBindingFromEvent,
  projectActionDraft,
  projectActionShortcutConflictLabels,
  projectActionShortcutRulesMayConflict,
  projectActionUnknownWhenVariables,
  validateProjectActionDraft,
} from '../lib/project-action-model'
import {
  ProjectActionEditorFields,
  type ProjectActionShortcutEditor,
} from './ProjectActionEditorFields'

interface ProjectActionEditorDialogProps {
  readonly action: ProjectAction | null
  readonly actions: readonly ProjectAction[]
  readonly builtInBindings: BuiltInShortcutSource
  readonly saving: boolean
  readonly onSave: (input: ProjectActionInput) => Promise<void>
  readonly onDelete: (actionId: string) => Promise<void>
  readonly onClose: () => void
}

interface ProjectActionEditorModel {
  readonly headingId: string
  readonly draft: ProjectActionDraft
  readonly editing: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly shortcutEditor: ProjectActionShortcutEditor
}

interface ProjectActionEditorActions {
  readonly onClose: () => void
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  readonly onDelete: () => void
  readonly onDraftChange: (patch: Partial<ProjectActionDraft>) => void
}

function projectBindingCount(actions: readonly ProjectAction[], excludedActionId?: string) {
  return actions.reduce(
    (count, action) =>
      action.id === excludedActionId ? count : count + projectActionShortcutRules(action).length,
    0,
  )
}

function draftShortcutConflictLabels(
  draft: ProjectActionDraft,
  props: Pick<ProjectActionEditorDialogProps, 'action' | 'actions' | 'builtInBindings'>,
) {
  const persisted = props.actions.filter((action) => action.id !== props.action?.id)
  return draft.shortcutRules.map((rule, ruleIndex) => {
    if (rule.shortcut === null) return []
    const candidate = {
      shortcut: rule.shortcut,
      ...(rule.when.trim().length > 0 ? { when: rule.when.trim() } : {}),
    }
    const labels = projectActionShortcutConflictLabels(
      '__draft__',
      -1,
      candidate,
      persisted,
      props.builtInBindings,
    )
    for (const [otherIndex, other] of draft.shortcutRules.entries()) {
      if (otherIndex === ruleIndex || other.shortcut === null) continue
      const otherCandidate = {
        shortcut: other.shortcut,
        ...(other.when.trim().length > 0 ? { when: other.when.trim() } : {}),
      }
      if (projectActionShortcutRulesMayConflict(candidate, otherCandidate)) {
        labels.push(`Binding ${String(otherIndex + 1)}`)
      }
    }
    return [...new Set(labels)].sort()
  })
}

function ProjectActionEditorForm(props: {
  readonly model: ProjectActionEditorModel
  readonly actions: ProjectActionEditorActions
}) {
  return (
    <ModalDialog
      labelledBy={props.model.headingId}
      onClose={props.actions.onClose}
      className="max-w-2xl overflow-hidden"
    >
      <form className="flex max-h-full flex-col" onSubmit={props.actions.onSubmit}>
        <header className="shrink-0 border-b border-border px-5 py-4">
          <h2 id={props.model.headingId} className="text-base font-semibold text-text-primary">
            {props.model.editing ? 'Edit action' : 'Add action'}
          </h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Project commands run in the active Session Working path.
          </p>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <ProjectActionEditorFields
            draft={props.model.draft}
            shortcutEditor={props.model.shortcutEditor}
            onChange={props.actions.onDraftChange}
          />
          {props.model.error !== null ? (
            <p role="alert" className="mt-3 text-xs text-error-text">
              {props.model.error}
            </p>
          ) : null}
        </div>
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          {props.model.editing ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={props.model.saving}
              onClick={props.actions.onDelete}
              className="mr-auto"
            >
              Delete
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          <Button type="button" variant="ghost" size="sm" onClick={props.actions.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={props.model.saving}>
            {props.model.editing ? 'Save changes' : 'Save action'}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  )
}

export function ProjectActionEditorDialog(props: ProjectActionEditorDialogProps) {
  const headingId = useId()
  const [draft, setDraft] = useState(() => projectActionDraft(props.action))
  const nextBindingKeyRef = useRef(draft.shortcutRules.length)
  const [error, setError] = useState<string | null>(null)
  const shortcutRuleLimit = Math.max(
    0,
    PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT -
      projectBindingCount(props.actions, props.action?.id),
  )

  function patchDraft(patch: Partial<ProjectActionDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
  }

  function patchShortcutRule(index: number, patch: Partial<ProjectActionShortcutRuleDraft>) {
    setDraft((current) => ({
      ...current,
      shortcutRules: current.shortcutRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch, order: null } : rule,
      ),
    }))
    setError(null)
  }

  function addShortcutRule() {
    const draftKey = `added-binding-${String(nextBindingKeyRef.current)}`
    nextBindingKeyRef.current += 1
    setDraft((current) => ({
      ...current,
      shortcutRules: [...current.shortcutRules, emptyProjectActionShortcutRuleDraft(draftKey)],
    }))
    setError(null)
  }

  function removeShortcutRule(index: number) {
    setDraft((current) => ({
      ...current,
      shortcutRules: current.shortcutRules.filter((_, ruleIndex) => ruleIndex !== index),
    }))
    setError(null)
  }

  function recordShortcut(index: number, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Backspace' || event.key === 'Delete') {
      patchShortcutRule(index, { shortcut: null })
      return
    }
    const binding = projectActionBindingFromEvent(event, usesAppleShortcuts())
    if (binding === null) {
      setError('Use Command, Control, Alt, or Shift with the key.')
      return
    }
    patchShortcutRule(index, { shortcut: binding })
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (props.saving) return
    const bindingCount = draft.shortcutRules.filter((rule) => rule.shortcut !== null).length
    if (bindingCount > shortcutRuleLimit) {
      setError(
        `This project may have at most ${String(PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT)} action bindings.`,
      )
      return
    }
    const validation = validateProjectActionDraft(draft)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    try {
      await props.onSave(validation.input)
      props.onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save action.')
    }
  }

  async function confirmDelete() {
    if (props.action === null || props.saving) return
    const confirmed = await api.showConfirm(
      `Delete action “${props.action.name}”?`,
      'This action cannot be undone.',
    )
    if (!confirmed) return
    try {
      await props.onDelete(props.action.id)
      props.onClose()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete action.')
    }
  }

  const shortcutEditor: ProjectActionShortcutEditor = {
    conflictLabels: draftShortcutConflictLabels(draft, props),
    ruleLimit: shortcutRuleLimit,
    unknownWhenVariables: draft.shortcutRules.map((rule) =>
      projectActionUnknownWhenVariables(rule.when),
    ),
    onAdd: addShortcutRule,
    onChange: patchShortcutRule,
    onRemove: removeShortcutRule,
    onKeyDown: recordShortcut,
  }

  return (
    <ProjectActionEditorForm
      model={{
        headingId,
        draft,
        editing: props.action !== null,
        saving: props.saving,
        error,
        shortcutEditor,
      }}
      actions={{
        onClose: props.onClose,
        onSubmit: (event) => void submit(event),
        onDelete: () => void confirmDelete(),
        onDraftChange: patchDraft,
      }}
    />
  )
}
