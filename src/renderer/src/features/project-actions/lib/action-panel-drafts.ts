import { Schema } from '@shared/schema'
import {
  actionDefinitionIdSchema,
  actionDefinitionSchema,
  preparationDefinitionSchema,
  projectTaskReferenceSchema,
} from '@shared/schemas/action-definitions'
import {
  projectActionIconSchema,
  projectActionShortcutRuleSchema,
} from '@shared/schemas/project-actions'
import type {
  ActionCatalog,
  ActionDefinition,
  ActionStorage,
  CommandRepairProposal,
  EffectiveDefinition,
  PreparationDefinition,
} from '@shared/types/action-definitions'

/**
 * A Project action draft: the user's unsaved composition, kept privately on this device across
 * leaving the panel and restarting, until saved or explicitly discarded (ADR 0038). Its fields
 * may be incomplete, so persistence uses a lenient schema rather than the save schema.
 */
const storageSchema = Schema.Literal('local', 'project')
const sourceSchema = Schema.Literal('script', 'command')
const draftInvocationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('command'),
    command: Schema.String,
    directory: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal('task'), task: projectTaskReferenceSchema }),
)
const draftActionDefinitionSchema = Schema.Struct({
  id: actionDefinitionIdSchema,
  name: Schema.String,
  icon: projectActionIconSchema,
  invocation: draftInvocationSchema,
  kind: Schema.Literal('task', 'service'),
  allowConcurrent: Schema.Boolean,
  autoOpenPreview: Schema.Boolean,
  previewUrl: Schema.optional(Schema.String),
  shortcutRules: Schema.optional(Schema.Array(projectActionShortcutRuleSchema)),
})
const draftPreparationDefinitionSchema = Schema.Struct({
  id: actionDefinitionIdSchema,
  profileId: actionDefinitionIdSchema,
  phase: Schema.Literal('setup', 'cleanup'),
  invocation: draftInvocationSchema,
})

export const actionDraftSchema = Schema.Struct({
  kind: Schema.Literal('action'),
  /** The saved action this draft edits; null composes a new action. */
  actionId: Schema.NullOr(actionDefinitionIdSchema),
  /** The saved definition when editing began, to notice changes made meanwhile. */
  base: Schema.NullOr(actionDefinitionSchema),
  baseStorage: Schema.NullOr(storageSchema),
  definition: draftActionDefinitionSchema,
  storage: storageSchema,
  source: sourceSchema,
  /** A name suggested from a script; replaced on the next pick while the user keeps it. */
  suggestedName: Schema.NullOr(Schema.String),
  /** Why an agent proposed this change, when the draft came from a Command repair proposal. */
  proposalReason: Schema.NullOr(Schema.String),
  /** Identifies the exact proposal (command, folder and reason) this draft was made from. */
  proposalKey: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
})
export const preparationDraftSchema = Schema.Struct({
  kind: Schema.Literal('preparation'),
  base: Schema.NullOr(preparationDefinitionSchema),
  baseStorage: Schema.NullOr(storageSchema),
  definition: draftPreparationDefinitionSchema,
  storage: storageSchema,
  source: sourceSchema,
})
export const actionPanelDraftSchema = Schema.Union(actionDraftSchema, preparationDraftSchema)

export type ActionDraft = Schema.Schema.Type<typeof actionDraftSchema>
export type PreparationDraft = Schema.Schema.Type<typeof preparationDraftSchema>
export type ActionPanelDraft = ActionDraft | PreparationDraft
export type DraftActionDefinition = ActionDraft['definition']
export type DraftPreparationDefinition = PreparationDraft['definition']
export type ActionPanelSource = ActionDraft['source']

const storageFor = (source: EffectiveDefinition<unknown>['source']): ActionStorage =>
  source === 'project' ? 'project' : 'local'
const sourceFor = (definition: { readonly invocation: { readonly type: string } }) =>
  definition.invocation.type === 'task' ? ('script' as const) : ('command' as const)

export function newActionDraft(hasScripts: boolean): ActionDraft {
  return {
    kind: 'action',
    actionId: null,
    base: null,
    baseStorage: null,
    definition: {
      id: crypto.randomUUID(),
      name: '',
      icon: 'play',
      invocation: { type: 'command', command: '', directory: '.' },
      kind: 'task',
      allowConcurrent: false,
      autoOpenPreview: false,
    },
    storage: 'local',
    source: hasScripts ? 'script' : 'command',
    suggestedName: null,
    proposalReason: null,
    proposalKey: null,
  }
}

export function editActionDraft(entry: EffectiveDefinition<ActionDefinition>): ActionDraft {
  return {
    kind: 'action',
    actionId: entry.definition.id,
    base: entry.definition,
    baseStorage: storageFor(entry.source),
    definition: entry.definition,
    storage: storageFor(entry.source),
    source: sourceFor(entry.definition),
    suggestedName: null,
    proposalReason: null,
    proposalKey: null,
  }
}

/** Two proposals with the same reason but a different command are different proposals. */
export function proposalKey(proposal: CommandRepairProposal) {
  return stableJson({ proposed: proposal.proposed, reason: proposal.reason })
}

/** The agent's proposal becomes the draft; nothing is applied until the user saves. */
export function proposalActionDraft(
  entry: EffectiveDefinition<ActionDefinition>,
  proposal: CommandRepairProposal,
): ActionDraft {
  return {
    ...editActionDraft(entry),
    definition: {
      ...entry.definition,
      invocation: {
        type: 'command',
        command: proposal.proposed.command,
        directory: proposal.proposed.directory,
      },
    },
    source: 'command',
    proposalReason: proposal.reason,
    proposalKey: proposalKey(proposal),
  }
}

export function newPreparationDraft(
  phase: PreparationDefinition['phase'],
  profileId: string,
  hasScripts: boolean,
): PreparationDraft {
  return {
    kind: 'preparation',
    base: null,
    baseStorage: null,
    definition: {
      id: crypto.randomUUID(),
      profileId,
      phase,
      invocation: { type: 'command', command: '', directory: '.' },
    },
    storage: 'local',
    source: hasScripts ? 'script' : 'command',
  }
}

export function editPreparationDraft(
  entry: EffectiveDefinition<PreparationDefinition>,
): PreparationDraft {
  return {
    kind: 'preparation',
    base: entry.definition,
    baseStorage: storageFor(entry.source),
    definition: entry.definition,
    storage: storageFor(entry.source),
    source: sourceFor(entry.definition),
  }
}

/** Which saved thing a draft is for; a project holds one draft at a time (ADR 0038). */
export function draftTarget(draft: ActionPanelDraft) {
  if (draft.kind === 'action') return `action:${draft.actionId ?? 'new'}`
  return `preparation:${draft.definition.profileId}:${draft.definition.phase}`
}

/** Key-order-independent JSON, so equal definitions from different sources compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameDefinition(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right)
}

function hasInvocation(invocation: DraftActionDefinition['invocation']) {
  return invocation.type === 'task' || invocation.command.trim().length > 0
}

/** A pristine draft is not "unfinished": leaving it keeps nothing. */
export function isDraftDirty(draft: ActionPanelDraft) {
  if (draft.kind === 'action' && draft.proposalReason !== null) return true
  if (draft.base === null) {
    if (!hasInvocation(draft.definition.invocation)) {
      return draft.kind === 'action' && draft.definition.name.trim().length > 0
    }
    return true
  }
  return !sameDefinition(draft.definition, draft.base) || draft.storage !== draft.baseStorage
}

/** Plain words for what is unfinished, for "Continue …" and the one-draft prompt. */
export function draftDescription(draft: ActionPanelDraft) {
  if (draft.kind === 'preparation')
    return draft.definition.phase === 'setup' ? 'your worktree setup' : 'your worktree cleanup'
  if (draft.base === null) return 'a new action'
  return `changes to ${draft.base.name}`
}

export function continueDraftLabel(draft: ActionPanelDraft) {
  if (draft.kind === 'preparation')
    return draft.definition.phase === 'setup'
      ? 'Continue worktree setup'
      : 'Continue worktree cleanup'
  return draft.base === null ? 'Continue new action' : `Continue editing ${draft.base.name}`
}

export type DraftBaseState =
  | { readonly kind: 'current' }
  | { readonly kind: 'changed'; readonly current: ActionDefinition | PreparationDefinition }
  | { readonly kind: 'removed' }

/**
 * Whether the saved definition a draft edits still matches what the draft started from. An action
 * is found by id; preparation by its profile/phase slot, because peers may create independent ids
 * for the same slot and a save replaces the slot.
 */
export function draftBaseState(draft: ActionPanelDraft, catalog: ActionCatalog): DraftBaseState {
  if (draft.kind === 'action') {
    if (draft.base === null) return { kind: 'current' }
    const baseId = draft.base.id
    return compareBase(
      draft.base,
      catalog.actions.find(({ definition }) => definition.id === baseId)?.definition,
    )
  }
  const slot = draft.base ?? draft.definition
  const current = catalog.preparation.find(
    ({ definition }) => definition.profileId === slot.profileId && definition.phase === slot.phase,
  )?.definition
  // A new setup only conflicts when someone filled the slot meanwhile.
  if (draft.base === null) return current ? { kind: 'changed', current } : { kind: 'current' }
  return compareBase(draft.base, current)
}

function compareBase(
  base: ActionDefinition | PreparationDefinition,
  current: ActionDefinition | PreparationDefinition | undefined,
): DraftBaseState {
  if (!current) return { kind: 'removed' }
  return sameDefinition(current, base) ? { kind: 'current' } : { kind: 'changed', current }
}
