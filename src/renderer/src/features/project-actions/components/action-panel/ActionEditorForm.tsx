import {
  ACTION_DEFINITION_LIMITS,
  type ActionCatalog,
  type ActionDefinition,
  type EffectiveDefinition,
} from '@shared/types/action-definitions'
import { useId } from 'react'
import { TextInput } from '@/shared/ui/TextInput'
import { useActionEditorModel } from '../../hooks/useActionEditorModel'
import { useSaveActionDraft } from '../../hooks/useSaveActionDraft'
import { applyActionSource, applyScriptPick } from '../../lib/action-draft-edits'
import {
  actionChanges,
  actionSummaryLine,
  actionSummarySentence,
} from '../../lib/action-panel-changes'
import { type ActionDraft, isDraftDirty } from '../../lib/action-panel-drafts'
import { type ActionPanelRequest, useActionPanelStore } from '../../state/action-panel-store'
import { ActionRemoval, BaseStateNotice } from './ActionEditorParts'
import { ActionOptionalRows } from './ActionOptionalRows'
import { ActionPanelChrome, type ActionPanelChromeFrame, PanelQuestion } from './ActionPanelChrome'
import { PanelFooter } from './PanelFooter'
import { ProposalNotice } from './PanelNotices'
import { PanelSummary } from './PanelSummary'
import { SourceQuestion } from './SourceQuestion'

type ActionRequest = Extract<ActionPanelRequest, { kind: 'action' }>

/** The two required questions, in order (ADR 0038). */
const RUN_QUESTION = 1
const NAME_QUESTION = 2

export interface ActionEditorFormProps {
  readonly chrome: ActionPanelChromeFrame
  readonly request: ActionRequest
  readonly catalog: ActionCatalog
  readonly entry: EffectiveDefinition<ActionDefinition> | undefined
  readonly draft: ActionDraft
  readonly onChange: (draft: ActionDraft) => void
  readonly onDiscard: () => void
}

/** Two required questions, then quiet optional settings (ADR 0038). */
export function ActionEditorForm(props: ActionEditorFormProps) {
  const { draft, onChange, catalog, entry, request } = props
  const model = useActionEditorModel({ scope: request.scope, catalog, entry, draft })
  const saver = useSaveActionDraft({
    scope: request.scope,
    canRun: request.origin === 'session' && request.scope.sessionId !== undefined,
    origin: request.origin,
  })
  const definition = draft.definition
  return (
    <ActionPanelChrome
      {...props.chrome}
      title={entry ? 'Edit action' : 'New action'}
      description={
        <>
          Save a command once, then run it with one click from{' '}
          <strong className="font-medium text-text-secondary">+ Action</strong>. Only the first two
          questions are needed.
        </>
      }
      footer={
        <PanelFooter
          summary={
            model.hasSource ? (
              <PanelSummary
                line={actionSummaryLine(model.summary)}
                sentence={actionSummarySentence(model.summary)}
              />
            ) : null
          }
          error={saver.error}
          saveLabel={entry ? 'Save changes' : 'Save action'}
          canSave={model.canSave}
          busy={saver.busy}
          dirty={isDraftDirty(draft)}
          actions={{ onSave: () => void saver.save(draft), onDiscard: props.onDiscard }}
        />
      }
    >
      <BaseStateNotice
        draft={draft}
        catalog={catalog}
        onChange={onChange}
        onDiscard={props.onDiscard}
        onSaveAsNew={(next) => {
          // The draft now composes a new action, so the panel must edit "new", not the removed id.
          onChange(next)
          useActionPanelStore.getState().openPanel({
            kind: 'action',
            scope: request.scope,
            actionId: null,
            origin: request.origin,
          })
        }}
      />
      {draft.proposalReason !== null && draft.base ? (
        <ProposalNotice
          reason={draft.proposalReason}
          changes={actionChanges(draft.base, definition)}
        />
      ) : null}
      <PanelQuestion number={RUN_QUESTION} title="What should it run?">
        <SourceQuestion
          scope={request.scope}
          source={draft.source}
          invocation={definition.invocation}
          onSourceChange={(source, command) => onChange(applyActionSource(draft, source, command))}
          onPick={(task) => onChange(applyScriptPick(draft, task.reference))}
          onInvocationChange={(invocation) =>
            onChange({ ...draft, definition: { ...definition, invocation } })
          }
        />
      </PanelQuestion>
      <NameQuestion
        name={definition.name}
        taken={model.nameTaken ? model.name : null}
        onChange={(name) => onChange({ ...draft, definition: { ...definition, name } })}
      />
      <ActionOptionalRows
        projectPath={request.scope.projectPath}
        draft={draft}
        sharedEdit={model.sharedEdit}
        onChange={onChange}
      />
      {entry ? (
        <ActionRemoval entry={entry} busy={saver.busy} onRemove={() => void saver.remove(entry)} />
      ) : null}
    </ActionPanelChrome>
  )
}

function NameQuestion(props: {
  readonly name: string
  readonly taken: string | null
  readonly onChange: (name: string) => void
}) {
  const id = useId()
  return (
    <PanelQuestion
      number={NAME_QUESTION}
      title="What should it be called?"
      help="This is the name you’ll click in the + Action menu."
    >
      <label htmlFor={id} className="sr-only">
        Name
      </label>
      <TextInput
        id={id}
        maxLength={ACTION_DEFINITION_LIMITS.NAME_LENGTH}
        className="py-2.5 text-base"
        aria-invalid={props.taken ? true : undefined}
        aria-describedby={props.taken ? `${id}-taken` : undefined}
        value={props.name}
        placeholder="For example: Start dev server"
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.taken ? (
        <p id={`${id}-taken`} className="text-sm text-error-text">
          You already have an action called {props.taken}. Pick a different name.
        </p>
      ) : null}
    </PanelQuestion>
  )
}
