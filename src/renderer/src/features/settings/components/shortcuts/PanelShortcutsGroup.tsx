import {
  type ExtensionPanelShortcutBindings,
  type ShortcutBinding,
  type ShortcutRules,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import { type KeyboardEvent, useState } from 'react'
import type { ExtensionSidePanelSurfaceEntry } from '@/features/extensions'
import { usePreferencesStore } from '@/features/settings/state'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import {
  isShortcutModifierKey,
  ShortcutBindingButton,
  ShortcutConflictNotice,
  shortcutBindingFromEvent,
} from '@/shared/ui/ShortcutRecorder'
import { usePanelShortcutSaving } from '../../hooks/usePanelShortcutSaving'
import {
  buildBuiltInPanelShortcutRows,
  buildExtensionPanelShortcutGroups,
  extensionPanelBindingConflictLabels,
  type PanelShortcutGroup,
  type PanelShortcutRow,
  panelCommandRulesWithBinding,
} from '../../lib/panel-shortcut-model'
import {
  type ShortcutBrowserRow,
  shortcutBrowserConflictLabels,
} from '../../lib/shortcut-browser-model'
import { BlockingConflictNotice, PanelShortcutActions } from './PanelShortcutRowParts'

interface PanelShortcutContext {
  readonly panels: readonly ExtensionSidePanelSurfaceEntry[]
  readonly ruleRows: readonly ShortcutBrowserRow[]
  readonly saving: boolean
  readonly onError: (message: string | null) => void
  readonly save: (row: PanelShortcutRow, binding: ShortcutBinding | null) => Promise<void>
  readonly reset: (row: PanelShortcutRow) => Promise<void>
}

interface PanelShortcutDraft {
  readonly row: PanelShortcutRow
  readonly draft: ShortcutBinding | null
  readonly dirty: boolean
  readonly rules: ShortcutRules
  readonly bindings: ExtensionPanelShortcutBindings
}

function draftConflicts(input: PanelShortcutDraft, context: PanelShortcutContext) {
  const { row, draft, rules, bindings } = input
  if (!input.dirty || draft === null) return { blocking: [], warnings: [] }
  if (row.kind === 'extension-panel') {
    return {
      blocking: extensionPanelBindingConflictLabels({
        rules,
        bindings: { ...bindings, [row.surfaceId]: draft },
        panels: context.panels,
        target: { kind: 'extension-panel', surfaceId: row.surfaceId },
      }),
      warnings: [],
    }
  }
  const nextRules = panelCommandRulesWithBinding(rules, row.command, draft)
  const otherRows = context.ruleRows.filter(
    (candidate) => candidate.kind !== 'builtin' || candidate.command !== row.command,
  )
  const nextRule = nextRules.at(-1)
  return {
    blocking: extensionPanelBindingConflictLabels({
      rules: nextRules,
      bindings,
      panels: context.panels,
      target: { kind: 'command', command: row.command },
    }),
    warnings: shortcutBrowserConflictLabels(otherRows, {
      rowId: row.id,
      binding: draft,
      when: nextRule?.when ?? '',
    }),
  }
}

function PanelShortcutItem(props: {
  readonly row: PanelShortcutRow
  readonly context: PanelShortcutContext
}) {
  const { row, context } = props
  const [draft, setDraft] = useState<ShortcutBinding | null>(row.binding)
  const [recording, setRecording] = useState(false)
  const rules = usePreferencesStore((state) => state.settings.shortcutRules)
  const bindings = usePreferencesStore((state) => state.settings.extensionPanelShortcutBindings)
  const persistedKey = row.binding === null ? null : shortcutBindingKey(row.binding)
  const dirty = (draft === null ? null : shortcutBindingKey(draft)) !== persistedKey
  const conflicts = draftConflicts({ row, draft, dirty, rules, bindings }, context)
  const canSave = !context.saving && draft !== null && conflicts.blocking.length === 0

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setDraft(row.binding)
      setRecording(false)
      return
    }
    const next = shortcutBindingFromEvent(event)
    if (next === null) {
      if (!isShortcutModifierKey(event.key)) {
        context.onError('Use Command, Control, Alt, or Shift with the key.')
      }
      return
    }
    setDraft(next)
    setRecording(false)
    context.onError(null)
  }

  return (
    <article className="space-y-2 px-4 py-3" aria-label={row.label}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-medium text-text-primary">{row.label}</h4>
            {row.kind === 'extension-panel' && !row.installed ? (
              <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-text-muted">
                Not installed
              </span>
            ) : null}
          </div>
          <p className="text-xs text-text-tertiary">{row.description}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <PanelShortcutActions
            row={row}
            context={context}
            dirty={dirty}
            canSave={canSave}
            onDiscard={() => setDraft(row.binding)}
            onSave={() => {
              if (draft !== null) void context.save(row, draft)
            }}
          />
          <ShortcutBindingButton
            label={`Change shortcut for ${row.label}`}
            binding={draft}
            recording={recording}
            disabled={context.saving}
            onClick={() => {
              setRecording(true)
              context.onError(null)
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      <BlockingConflictNotice labels={conflicts.blocking} />
      <ShortcutConflictNotice labels={conflicts.warnings} />
    </article>
  )
}

function rowMatches(row: PanelShortcutRow, group: PanelShortcutGroup, query: string) {
  if (query.length === 0) return true
  return [row.label, row.description, group.title, formatShortcutBinding(row.binding)].some(
    (value) => value.toLowerCase().includes(query),
  )
}

/** Settings › Shortcuts › Panels: one shortcut per Right panel surface (ADR 0043). */
export function PanelShortcutsGroup(props: {
  readonly panels: readonly ExtensionSidePanelSurfaceEntry[]
  readonly ruleRows: readonly ShortcutBrowserRow[]
  readonly query: string
  readonly onError: (message: string | null) => void
}) {
  const rules = usePreferencesStore((state) => state.settings.shortcutRules)
  const bindings = usePreferencesStore((state) => state.settings.extensionPanelShortcutBindings)
  const { saving, save, reset } = usePanelShortcutSaving(props.onError)
  const context: PanelShortcutContext = {
    panels: props.panels,
    ruleRows: props.ruleRows,
    saving,
    onError: props.onError,
    save,
    reset,
  }
  const query = props.query.trim().toLowerCase()
  const groups: readonly PanelShortcutGroup[] = [
    { id: 'built-in', title: 'OpenWaggle', rows: buildBuiltInPanelShortcutRows(rules) },
    ...buildExtensionPanelShortcutGroups(props.panels, bindings),
  ]
    .map((group) => ({ ...group, rows: group.rows.filter((row) => rowMatches(row, group, query)) }))
    .filter((group) => group.rows.length > 0)
  if (groups.length === 0) return null

  return (
    <section aria-labelledby="panel-shortcuts-heading" className="space-y-3">
      <div>
        <h3 id="panel-shortcuts-heading" className="text-sm font-medium text-text-primary">
          Panels
        </h3>
        <p className="mt-0.5 text-xs text-text-tertiary">
          A panel shortcut shows that panel in the Right panel, or closes the Right panel when the
          panel is already shown. Extension panels start unassigned.
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <h4 className="text-xs font-medium text-text-secondary">{group.title}</h4>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg-secondary">
            {group.rows.map((row) => (
              <PanelShortcutItem
                key={`${row.id}:${row.binding === null ? '' : shortcutBindingKey(row.binding)}`}
                row={row}
                context={context}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
