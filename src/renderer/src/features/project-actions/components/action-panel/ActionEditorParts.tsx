import type {
  ActionCatalog,
  ActionDefinition,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import { actionChanges } from '../../lib/action-panel-changes'
import { type ActionDraft, draftBaseState, editActionDraft } from '../../lib/action-panel-drafts'
import { ChangedSinceNotice, RemovedSinceNotice } from './PanelNotices'
import { RemovalSection } from './RemovalSection'

export function ActionRemoval(props: {
  readonly entry: EffectiveDefinition<ActionDefinition>
  readonly busy: boolean
  readonly onRemove: () => void
}) {
  const running = 'Anything already running keeps running.'
  if (props.entry.source === 'override')
    return (
      <RemovalSection
        label="Restore shared version"
        consequence={`Your private version is removed and you’ll use the shared “${props.entry.definition.name}” again. ${running}`}
        confirmLabel="Restore shared version"
        busy={props.busy}
        onConfirm={props.onRemove}
      />
    )
  return (
    <RemovalSection
      label="Remove this action"
      consequence={
        props.entry.source === 'project'
          ? `Everyone on the project loses this action once you commit. ${running}`
          : `It’s removed from this computer. ${running}`
      }
      confirmLabel="Remove"
      busy={props.busy}
      onConfirm={props.onRemove}
    />
  )
}

export function BaseStateNotice(props: {
  readonly draft: ActionDraft
  readonly catalog: ActionCatalog
  readonly onChange: (draft: ActionDraft) => void
  readonly onDiscard: () => void
}) {
  const { draft } = props
  const state = draftBaseState(draft, props.catalog)
  if (state.kind === 'current' || draft.base === null) return null
  if (state.kind === 'removed')
    return (
      <RemovedSinceNotice
        name={draft.base.name}
        kind="action"
        onDiscard={props.onDiscard}
        onSaveAsNew={() =>
          props.onChange({
            ...draft,
            actionId: null,
            base: null,
            baseStorage: null,
            definition: { ...draft.definition, id: crypto.randomUUID() },
          })
        }
      />
    )
  const current = props.catalog.actions.find(({ definition }) => definition.id === draft.base?.id)
  if (!current) return null
  return (
    <ChangedSinceNotice
      name={draft.base.name}
      changes={actionChanges(draft.base, current.definition)}
      onKeepMine={() => props.onChange({ ...draft, base: current.definition })}
      onUseNew={() => props.onChange(editActionDraft(current))}
    />
  )
}
