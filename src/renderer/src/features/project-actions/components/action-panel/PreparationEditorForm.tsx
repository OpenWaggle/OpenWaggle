import type {
  ActionCatalog,
  EffectiveDefinition,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import { useState } from 'react'
import { useActionDiscovery } from '../../hooks/useNativeActions'
import { useSavePreparationDraft } from '../../hooks/useSavePreparationDraft'
import {
  applyPreparationPick,
  applyPreparationSource,
  displayedCommand,
  invocationFolder,
} from '../../lib/action-draft-edits'
import { preparationChanges, preparationSummarySentence } from '../../lib/action-panel-changes'
import {
  capitalized,
  FOLDER_QUESTION,
  folderLabel,
  PREPARATION_COPY,
  preparationStorageCopy,
  SHARED_PREPARATION_SAVE_NOTE,
} from '../../lib/action-panel-copy'
import {
  draftBaseState,
  editPreparationDraft,
  isDraftDirty,
  type PreparationDraft,
} from '../../lib/action-panel-drafts'
import type { ActionPanelRequest } from '../../state/action-panel-store'
import { FolderField } from './ActionOptionalRows'
import { ActionPanelChrome, type ActionPanelChromeFrame, PanelQuestion } from './ActionPanelChrome'
import { ChoiceCards } from './ChoiceCards'
import { OptionalSettingRow, OptionalSettings } from './OptionalSettings'
import { PanelFooter } from './PanelFooter'
import { ChangedSinceNotice, RemovedSinceNotice } from './PanelNotices'
import { PanelSummary } from './PanelSummary'
import { RemovalSection } from './RemovalSection'
import { SourceQuestion } from './SourceQuestion'

type PreparationRequest = Extract<ActionPanelRequest, { kind: 'preparation' }>
type Entry = EffectiveDefinition<PreparationDefinition>

export interface PreparationEditorFormProps {
  readonly chrome: ActionPanelChromeFrame & { readonly title: string }
  readonly request: PreparationRequest
  readonly catalog: ActionCatalog
  readonly entry: Entry | undefined
  readonly draft: PreparationDraft
  readonly onChange: (draft: PreparationDraft) => void
  readonly onDiscard: () => void
}

function removalCopy(entry: Entry, noun: string) {
  if (entry.source === 'override')
    return {
      label: 'Restore shared version',
      confirm: 'Restore shared version',
      consequence: `Your private version is removed and you’ll use the shared ${noun} again.`,
    }
  const kept = 'Worktrees that already have it keep their own copy.'
  return {
    label: `Remove this ${noun}`,
    confirm: 'Remove',
    consequence:
      entry.source === 'project'
        ? `Everyone on the project loses this ${noun} once you commit. ${kept}`
        : `New worktrees won’t run it any more. ${kept}`,
  }
}

/** Setup and cleanup share the action panel's standards: one question, the rest optional. */
export function PreparationEditorForm(props: PreparationEditorFormProps) {
  const { draft, onChange, request, entry } = props
  const discovery = useActionDiscovery(request.scope)
  const saver = useSavePreparationDraft(request.scope)
  const invocation = draft.definition.invocation
  const command = displayedCommand(invocation, discovery.data)
  const hasSource = invocation.type === 'task' || command.length > 0
  const storageShort = preparationStorageCopy(
    request.phase,
    entry !== undefined && entry.source !== 'local',
  ).options[draft.storage].short
  const summary = preparationSummarySentence({
    phase: request.phase,
    command,
    directory: invocationFolder(invocation),
    storage: draft.storage,
  })
  const noun = PREPARATION_COPY[request.phase].noun
  const removal = entry ? removalCopy(entry, noun) : null
  return (
    <ActionPanelChrome
      {...props.chrome}
      description={PREPARATION_COPY[request.phase].description}
      footer={
        <PanelFooter
          summary={
            hasSource ? (
              <PanelSummary
                line={{ command, after: ` · ${storageShort.toLowerCase()}` }}
                sentence={summary}
              />
            ) : null
          }
          note={draft.storage === 'project' ? SHARED_PREPARATION_SAVE_NOTE : null}
          error={saver.error}
          saveLabel={`Save ${noun}`}
          canSave={hasSource && draftBaseState(draft, props.catalog).kind === 'current'}
          busy={saver.busy}
          dirty={isDraftDirty(draft)}
          actions={{ onSave: () => void saver.save(draft), onDiscard: props.onDiscard }}
        />
      }
    >
      <PreparationBaseNotice {...props} noun={noun} />
      <PanelQuestion number={1} title="What should it run?">
        <SourceQuestion
          scope={request.scope}
          source={draft.source}
          invocation={invocation}
          onSourceChange={(source, command) =>
            onChange(applyPreparationSource(draft, source, command))
          }
          onPick={(task) => onChange(applyPreparationPick(draft, task))}
          onInvocationChange={(next) =>
            onChange({ ...draft, definition: { ...draft.definition, invocation: next } })
          }
        />
      </PanelQuestion>
      <PreparationOptionalRows
        draft={draft}
        sharedEdit={entry !== undefined && entry.source !== 'local'}
        onChange={onChange}
      />
      {entry && removal ? (
        <RemovalSection
          label={removal.label}
          consequence={removal.consequence}
          confirmLabel={removal.confirm}
          busy={saver.busy}
          onConfirm={() => void saver.remove(entry)}
        />
      ) : null}
    </ActionPanelChrome>
  )
}

function PreparationBaseNotice(props: PreparationEditorFormProps & { readonly noun: string }) {
  const { draft, onChange, entry } = props
  const state = draftBaseState(draft, props.catalog)
  if (!draft.base || state.kind === 'current') return null
  if (state.kind === 'removed')
    return (
      <RemovedSinceNotice
        name={`The ${props.noun}`}
        kind={props.request.phase}
        onDiscard={props.onDiscard}
        onSaveAsNew={() => onChange({ ...draft, base: null, baseStorage: null })}
      />
    )
  if (!entry) return null
  return (
    <ChangedSinceNotice
      name={`The ${props.noun}`}
      changes={preparationChanges(draft.base, entry.definition)}
      onKeepMine={() => onChange({ ...draft, base: entry.definition })}
      onUseNew={() => onChange(editPreparationDraft(entry))}
    />
  )
}

function PreparationOptionalRows(props: {
  readonly draft: PreparationDraft
  readonly sharedEdit: boolean
  readonly onChange: (draft: PreparationDraft) => void
}) {
  const [open, setOpen] = useState<'storage' | 'folder' | null>(null)
  const { draft, onChange } = props
  const invocation = draft.definition.invocation
  const storageCopy = preparationStorageCopy(draft.definition.phase, props.sharedEdit)
  const toggle = (key: 'storage' | 'folder') => ({
    open: open === key,
    onToggle: () => setOpen(open === key ? null : key),
  })
  return (
    <OptionalSettings>
      <OptionalSettingRow
        question={storageCopy.question}
        answer={storageCopy.options[draft.storage].short}
        {...toggle('storage')}
      >
        <ChoiceCards
          label={storageCopy.question}
          value={draft.storage}
          onChange={(storage) => onChange({ ...draft, storage })}
          choices={(['local', 'project'] as const).map((value) => ({
            value,
            ...storageCopy.options[value],
          }))}
        />
      </OptionalSettingRow>
      <OptionalSettingRow
        question={FOLDER_QUESTION}
        answer={capitalized(folderLabel(invocationFolder(invocation)))}
        {...toggle('folder')}
      >
        <FolderField
          invocation={invocation}
          onChange={(next) =>
            onChange({ ...draft, definition: { ...draft.definition, invocation: next } })
          }
        />
      </OptionalSettingRow>
    </OptionalSettings>
  )
}
