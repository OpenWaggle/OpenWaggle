import type { ActionDefinition, EffectiveDefinition } from '@shared/types/action-definitions'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { Play, RotateCw, ScrollText, Square, SquareTerminal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { actionInvocationLabel, actionRunLabel } from '../lib/native-action-display'
import { ProjectActionGlyph } from './ProjectActionGlyph'

export interface ProjectActionRowModel {
  readonly entry: EffectiveDefinition<ActionDefinition>
  /** Tells two same-named actions apart. */
  readonly hint: string | null
  /** Why the action cannot run in this workspace right now. */
  readonly unavailable: string | undefined
  /** The most recent run of this action in the workspace, if any. */
  readonly latestRun: ActionRun | null
  /** The most recent active run, which Stop and Restart operate on. */
  readonly activeRun: ActionRun | null
  readonly busy: boolean
  /** Running needs a Session in this project. */
  readonly canRun: boolean
  /** Opening a read-only terminal view needs a Session owner for the bottom drawer. */
  readonly canOpenTerminal: boolean
}

export interface ProjectActionRowActions {
  readonly onRun: () => void
  readonly onStop: (run: ActionRun) => void
  readonly onRestart: (run: ActionRun) => void
  readonly onShowOutput: (run: ActionRun) => void
  readonly onOpenInTerminal: (run: ActionRun) => void
}

/** The latest rule wins in a Project action's ordered shortcut stack. */
function shortcutHint(definition: ActionDefinition) {
  const rules = definition.shortcutRules ?? []
  let latest = rules.at(-1)
  for (const rule of rules) if ((rule.order ?? -1) > (latest?.order ?? -1)) latest = rule
  return latest ? formatShortcutBinding(latest.shortcut) : null
}

function runHasOutput(run: ActionRun) {
  return isActiveActionRun(run) || run.outputBytes > 0
}

function RunStatus({ run }: { readonly run: ActionRun }) {
  const active = isActiveActionRun(run)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs',
        active
          ? 'text-success'
          : run.status === 'failed'
            ? 'text-error-text'
            : 'text-text-tertiary',
      )}
    >
      {active ? <span aria-hidden className="size-1.5 rounded-full bg-success" /> : null}
      {actionRunLabel(run)}
    </span>
  )
}

function rowName(model: ProjectActionRowModel) {
  const { name } = model.entry.definition
  return model.hint ? `${name} (${model.hint})` : name
}

function RowSummary({ model }: { readonly model: ProjectActionRowModel }) {
  const { definition } = model.entry
  const shortcut = shortcutHint(definition)
  const command = actionInvocationLabel(definition.invocation)
  return (
    <div className="flex min-w-0 flex-1 basis-44 items-start gap-2">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-bg-hover text-text-secondary">
        <ProjectActionGlyph icon={definition.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm text-text-primary">{definition.name}</span>
          {model.hint ? (
            <span className="shrink-0 text-xs text-text-tertiary">{model.hint}</span>
          ) : null}
          {model.latestRun ? <RunStatus run={model.latestRun} /> : null}
        </div>
        <div className="flex min-w-0 items-baseline gap-2 text-xs text-text-tertiary">
          <span className="truncate font-mono" title={command}>
            {command}
          </span>
          {shortcut ? <kbd className="shrink-0 font-sans">{shortcut}</kbd> : null}
        </div>
        {model.unavailable && !model.activeRun ? (
          <p className="mt-0.5 text-xs text-text-tertiary">{model.unavailable}</p>
        ) : null}
      </div>
    </div>
  )
}

/** A long-running or non-concurrent action has one active run: Stop and Restart replace Run. */
function ActiveRunControls(props: {
  readonly model: ProjectActionRowModel
  readonly run: ActionRun
  readonly actions: ProjectActionRowActions
}) {
  const disabled = props.model.busy || props.run.status === 'stopping'
  const name = rowName(props.model)
  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        disabled={disabled}
        aria-label={`Stop ${name}`}
        onClick={() => props.actions.onStop(props.run)}
      >
        <Square className="size-3" />
        Stop
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        aria-label={`Restart ${name}`}
        onClick={() => props.actions.onRestart(props.run)}
      >
        <RotateCw className="size-3" />
        Restart
      </Button>
    </>
  )
}

function LaunchControls(props: {
  readonly model: ProjectActionRowModel
  readonly actions: ProjectActionRowActions
}) {
  const { model, actions } = props
  const name = rowName(model)
  const activeRun = model.activeRun
  const blocked = !model.canRun ? 'Select a session in this project to run actions.' : undefined
  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        disabled={model.busy || Boolean(model.unavailable ?? blocked)}
        title={model.unavailable ?? blocked}
        aria-label={`Run ${name}`}
        onClick={actions.onRun}
      >
        <Play className="size-3" />
        Run
      </Button>
      {activeRun ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={model.busy || activeRun.status === 'stopping'}
          aria-label={`Stop latest ${name}`}
          onClick={() => actions.onStop(activeRun)}
        >
          <Square className="size-3" />
          Stop
        </Button>
      ) : null}
    </>
  )
}

function OutputControls(props: {
  readonly model: ProjectActionRowModel
  readonly run: ActionRun
  readonly actions: ProjectActionRowActions
}) {
  const name = rowName(props.model)
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`Show output for ${name}`}
        onClick={() => props.actions.onShowOutput(props.run)}
      >
        <ScrollText className="size-3" />
        Show output
      </Button>
      {props.model.canOpenTerminal ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Open in terminal (read-only)"
          aria-label={`Open ${name} output in terminal`}
          onClick={() => props.actions.onOpenInTerminal(props.run)}
        >
          <SquareTerminal className="size-3.5" />
        </Button>
      ) : null}
    </>
  )
}

/** One saved action in the Project Actions surface: what it runs, its state and its controls. */
export function ProjectActionRow(props: {
  readonly model: ProjectActionRowModel
  readonly actions: ProjectActionRowActions
}) {
  const { model, actions } = props
  const { definition } = model.entry
  const exclusiveRun = definition.allowConcurrent ? null : model.activeRun
  const outputRun = model.latestRun && runHasOutput(model.latestRun) ? model.latestRun : null
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 last:border-0"
      data-action-id={definition.id}
    >
      <RowSummary model={model} />
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {exclusiveRun ? (
          <ActiveRunControls model={model} run={exclusiveRun} actions={actions} />
        ) : (
          <LaunchControls model={model} actions={actions} />
        )}
        {outputRun ? <OutputControls model={model} run={outputRun} actions={actions} /> : null}
      </div>
    </li>
  )
}
