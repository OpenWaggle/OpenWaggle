import { Button } from '@/shared/ui/Button'
import type { DefinitionChange } from '../../lib/action-panel-changes'

function ChangeList({ changes }: { readonly changes: readonly DefinitionChange[] }) {
  return (
    <ul className="grid gap-1.5 text-sm leading-6">
      {changes.map((change) => (
        <li key={change.label} className="break-words text-text-secondary">
          <span className="text-text-tertiary">{change.label}:</span>{' '}
          <code className="font-mono">{change.before || '—'}</code> →{' '}
          <code className="font-mono text-text-primary">{change.after || '—'}</code>
        </li>
      ))}
    </ul>
  )
}

/** The saved action changed after this draft began: say what changed, never overwrite silently. */
export function ChangedSinceNotice(props: {
  readonly name: string
  /** Replaces the default heading, such as when someone filled an empty slot meanwhile. */
  readonly heading?: string
  readonly changes: readonly DefinitionChange[]
  readonly onKeepMine: () => void
  readonly onUseNew: () => void
}) {
  return (
    <section
      aria-label="Changed since you started"
      className="grid gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3.5"
    >
      <p role="status" className="text-sm font-medium text-text-primary">
        {props.heading ?? `${props.name} was changed since you started editing`}
      </p>
      <ChangeList changes={props.changes} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={props.onKeepMine}>
          Keep my changes
        </Button>
        <Button variant="ghost" onClick={props.onUseNew}>
          Use the new version
        </Button>
      </div>
    </section>
  )
}

export function RemovedSinceNotice(props: {
  readonly name: string
  readonly kind: 'action' | 'setup' | 'cleanup'
  readonly onSaveAsNew: () => void
  readonly onDiscard: () => void
}) {
  return (
    <section
      aria-label="Removed since you started"
      className="grid gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3.5"
    >
      <p role="status" className="text-sm leading-6 text-text-primary">
        {props.name} was removed while you were editing it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={props.onSaveAsNew}>
          {props.kind === 'action'
            ? 'Save mine as a new action'
            : `Keep mine as a new ${props.kind}`}
        </Button>
        <Button variant="ghost" onClick={props.onDiscard}>
          Discard
        </Button>
      </div>
    </section>
  )
}

/** A draft from an agent's Command repair proposal: what it changes and why. */
export function ProposalNotice(props: {
  readonly reason: string
  readonly changes: readonly DefinitionChange[]
}) {
  return (
    <section
      aria-label="Proposed by the agent"
      className="grid gap-2.5 rounded-xl border border-info/40 bg-info/5 px-4 py-3.5"
    >
      <p className="text-sm font-medium text-text-primary">The agent proposes this change</p>
      <p className="text-sm leading-6 text-text-secondary">{props.reason}</p>
      <ChangeList changes={props.changes} />
      <p className="text-sm text-text-tertiary">
        Adjust anything you like. Nothing changes until you save.
      </p>
    </section>
  )
}

/** One draft per project: starting something else first shows what is unfinished. */
export function DraftSwitchPrompt(props: {
  readonly unfinished: string
  readonly replaceLabel: string
  readonly onContinue: () => void
  readonly onReplace: () => void
}) {
  return (
    <section className="grid gap-4 rounded-xl border border-border-light bg-bg px-5 py-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">You have something unfinished</h3>
        <p className="mt-1.5 text-sm leading-6 text-text-tertiary">
          You were working on {props.unfinished}. Continue it, or discard it and start this one.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" onClick={props.onContinue}>
          Continue
        </Button>
        <Button variant="secondary" size="md" onClick={props.onReplace}>
          {props.replaceLabel}
        </Button>
      </div>
    </section>
  )
}
