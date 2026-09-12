import type { ProjectAction, ProjectActionShortcutRule } from '@shared/types/project-actions'
import { type ShortcutRule, shortcutBindingKey } from '@shared/types/shortcuts'
import { Plus, RotateCcw, Search } from 'lucide-react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import type { ShortcutBrowserRow } from '../../lib/shortcut-browser-model'
import { BuiltInShortcutRow } from '../shortcuts/BuiltInShortcutRow'
import { AddShortcutBinding, ProjectShortcutRow } from '../shortcuts/ProjectShortcutRows'

export interface ShortcutsSectionModel {
  readonly actions: readonly ProjectAction[]
  readonly rows: readonly ShortcutBrowserRow[]
  readonly visibleRows: readonly ShortcutBrowserRow[]
  readonly query: string
  readonly adding: boolean
  readonly canAdd: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly projectError: string | null
  readonly builtInCount: number
  readonly projectCount: number
}

export interface ShortcutsSectionActions {
  readonly onSearch: (query: string) => void
  readonly onAddStart: () => void
  readonly onAddClose: () => void
  readonly onReset: () => void
  readonly onError: (message: string | null) => void
  readonly onBuiltInAdd: (rule: ShortcutRule) => Promise<boolean>
  readonly onBuiltInRemove: (rule: ShortcutRule) => Promise<boolean>
  readonly onBuiltInUpsert: (next: ShortcutRule, replace: ShortcutRule) => Promise<boolean>
  readonly onProjectUpdate: (
    actionId: string,
    rules: readonly ProjectActionShortcutRule[],
  ) => Promise<boolean>
}

function ShortcutsHeader(props: {
  readonly model: ShortcutsSectionModel
  readonly actions: ShortcutsSectionActions
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Keyboard shortcuts</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-text-tertiary">
          Search and edit every built-in and Project Action rule in one place. Rules are evaluated
          from newest to oldest; the first matching key and condition wins.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="xs"
          disabled={props.model.adding || !props.model.canAdd}
          onClick={props.actions.onAddStart}
        >
          <Plus className="size-3" />
          Add binding
        </Button>
        <Button
          variant="secondary"
          size="xs"
          disabled={props.model.saving}
          onClick={props.actions.onReset}
          leftIcon={<RotateCcw className="size-3" />}
        >
          Reset defaults
        </Button>
      </div>
    </div>
  )
}

function ShortcutSearch(props: {
  readonly query: string
  readonly onSearch: (query: string) => void
}) {
  return (
    <div className="relative max-w-md">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
        aria-hidden
      />
      <TextInput
        type="search"
        inputSize="sm"
        aria-label="Search keyboard shortcuts"
        placeholder="Search commands, keys, conditions, or sources"
        value={props.query}
        onChange={(event) => props.onSearch(event.currentTarget.value)}
        className="pl-8"
      />
    </div>
  )
}

function ShortcutRuleList(props: {
  readonly model: ShortcutsSectionModel
  readonly actions: ShortcutsSectionActions
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg-secondary">
      {props.model.visibleRows.map((row) =>
        row.kind === 'builtin' ? (
          <BuiltInShortcutRow
            key={`${row.id}:${shortcutBindingKey(row.binding)}:${row.when}`}
            row={row}
            rows={props.model.rows}
            saving={props.model.saving}
            onError={props.actions.onError}
            onRemove={props.actions.onBuiltInRemove}
            onUpsert={props.actions.onBuiltInUpsert}
          />
        ) : (
          <ProjectShortcutRow
            key={`${row.id}:${shortcutBindingKey(row.binding)}:${row.when}`}
            row={row}
            rows={props.model.rows}
            saving={props.model.saving}
            onError={props.actions.onError}
            onUpdate={props.actions.onProjectUpdate}
          />
        ),
      )}
    </div>
  )
}

export function ShortcutsSectionContent(props: {
  readonly model: ShortcutsSectionModel
  readonly actions: ShortcutsSectionActions
}) {
  return (
    <div className="max-w-5xl space-y-5">
      <ShortcutsHeader model={props.model} actions={props.actions} />
      <ShortcutSearch query={props.model.query} onSearch={props.actions.onSearch} />
      {props.model.adding ? (
        <AddShortcutBinding
          actions={props.model.actions}
          rows={props.model.rows}
          saving={props.model.saving}
          onClose={props.actions.onAddClose}
          onError={props.actions.onError}
          onUpdate={props.actions.onProjectUpdate}
          onAddBuiltIn={props.actions.onBuiltInAdd}
        />
      ) : null}
      {props.model.error ? (
        <p role="alert" className="text-xs text-error-text">
          {props.model.error}
        </p>
      ) : null}
      {props.model.projectError ? (
        <p role="alert" className="text-xs text-error-text">
          Project bindings could not be loaded: {props.model.projectError}
        </p>
      ) : null}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>
          {String(props.model.builtInCount)} built-in · {String(props.model.projectCount)} project
        </span>
        <span>{usesAppleShortcuts() ? 'macOS keys' : 'Windows / Linux keys'}</span>
      </div>
      {props.model.visibleRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-text-muted">
          No keyboard shortcuts match “{props.model.query.trim()}”.
        </div>
      ) : (
        <ShortcutRuleList model={props.model} actions={props.actions} />
      )}
      <p className="text-xs text-text-muted">
        Conditions support !, &amp;&amp;, ||, and nested groups. Unknown contexts are preserved and
        evaluate to false until provided by the runtime. Project Actions remain editable under
        Project actions.
      </p>
    </div>
  )
}
