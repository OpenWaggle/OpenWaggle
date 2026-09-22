import { match } from '@diegogbrisa/ts-match'
import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionManifest,
  PreparationDefinition,
  PreparationReview,
} from '@shared/types/action-definitions'
import { effective, effectivePreparation, upsertPreparation } from './effective-project-definitions'
import {
  retainPrivatePreparationProfiles,
  sharePreparationProfile,
} from './preparation-profile-context'

export interface LocalActionDocument {
  readonly manifest: ActionManifest
  readonly reviews: readonly PreparationReview[]
  readonly migration: { readonly version: 1; readonly legacySource: string | null }
}

export interface ActionPublicationIdentity {
  readonly id: string
  readonly device: string
  readonly inode: string
  readonly birthtime: string
}

export interface PendingActionPublication {
  readonly workspacePath: string
  /** Pins the directory retaining the displaced inode and the exclusive-install source. */
  readonly publication?: ActionPublicationIdentity
  /** Older journals without identity remain drafts; they cannot safely resume publication. */
  readonly workspaceIdentity?: {
    readonly device: string
    readonly inode: string
    readonly birthtime: string
    readonly resourceId: string | null
  }
  readonly previousSharedRevision: string
  readonly nextShared: ActionManifest
  readonly nextLocal: LocalActionDocument
}

export interface LocalActionState {
  readonly document: LocalActionDocument
  readonly pending: PendingActionPublication | null
}

export const EMPTY_ACTION_MANIFEST: ActionManifest = {
  version: 1,
  actions: [],
  profiles: [],
  preparation: [],
}

export function preparationExecutionKey(definition: PreparationDefinition): string {
  const invocation = match(definition.invocation)
    .with({ type: 'command' }, ({ command, directory }) => ({
      type: 'command',
      command,
      directory,
    }))
    .with({ type: 'task' }, ({ task }) => ({
      type: 'task',
      provider: task.provider,
      source: task.source,
      directory: task.directory,
      task: task.task,
      environment: task.environment ?? null,
    }))
    .exhaustive()
  return JSON.stringify({ phase: definition.phase, invocation })
}

export function resolveActionCatalog(
  document: LocalActionDocument,
  shared: ActionManifest,
  revision: string,
): ActionCatalog {
  validateSharedProfiles(shared)
  const actions = effective(document.manifest.actions, shared.actions)
  const profiles = effective(document.manifest.profiles, shared.profiles)
  if (!profiles.some(({ definition }) => definition.id === 'default'))
    profiles.unshift({ definition: { id: 'default', name: 'Default' }, source: 'local' })
  const preparation = effectivePreparation(document.manifest.preparation, shared.preparation).map(
    (entry) => {
      const previous = document.reviews.find(
        (review) => review.definitionId === entry.definition.id,
      )
      const sameExecution = previous?.fingerprint === preparationExecutionKey(entry.definition)
      const review = sameExecution
        ? previous.enabled
          ? ('enabled' as const)
          : ('disabled' as const)
        : ('required' as const)
      return { ...entry, review, ...(previous ? { previous } : {}) }
    },
  )
  const phases = new Set<string>()
  for (const { definition } of preparation) {
    if (!profiles.some(({ definition: profile }) => profile.id === definition.profileId))
      throw new Error(`Preparation profile ${definition.profileId} is missing.`)
    const phase = `${definition.profileId}:${definition.phase}`
    if (phases.has(phase))
      throw new Error(
        `Multiple ${definition.phase} definitions for profile ${definition.profileId}.`,
      )
    phases.add(phase)
  }
  return { revision, actions, profiles, preparation }
}

function upsert<T extends { readonly id: string }>(entries: readonly T[], value: T): readonly T[] {
  return entries.some((entry) => entry.id === value.id)
    ? entries.map((entry) => (entry.id === value.id ? value : entry))
    : [...entries, value]
}

function validateSharedProfiles(shared: ActionManifest) {
  for (const definition of shared.preparation) {
    if (
      definition.profileId !== 'default' &&
      !shared.profiles.some((profile) => profile.id === definition.profileId)
    )
      throw new Error(
        'Shared preparation requires a shared profile. Move or remove its setup and cleanup first.',
      )
  }
}

function moveActionCatalogDefinition(
  document: LocalActionDocument,
  shared: ActionManifest,
  edit: Extract<ActionCatalogEdit, { readonly type: 'move-definition' }>,
) {
  const move = <T extends { readonly id: string }>(
    personal: readonly T[],
    project: readonly T[],
    replace: (entries: readonly T[], definition: T) => readonly T[] = upsert,
  ) => {
    const definition =
      personal.find((entry) => entry.id === edit.id) ??
      project.find((entry) => entry.id === edit.id)
    if (!definition) throw new Error('The definition no longer exists.')
    return edit.storage === 'local'
      ? {
          personal: replace(personal, definition),
          project: project.filter((entry) => entry.id !== edit.id),
        }
      : {
          personal: personal.filter((entry) => entry.id !== edit.id),
          project: replace(project, definition),
        }
  }
  const next = match(edit.collection)
    .with('actions', () => {
      const moved = move(document.manifest.actions, shared.actions)
      return {
        document: { ...document, manifest: { ...document.manifest, actions: moved.personal } },
        shared: { ...shared, actions: moved.project },
      }
    })
    .with('profiles', () => {
      const moved = move(document.manifest.profiles, shared.profiles)
      return {
        document: { ...document, manifest: { ...document.manifest, profiles: moved.personal } },
        shared: { ...shared, profiles: moved.project },
      }
    })
    .with('preparation', () => {
      const moved = move(document.manifest.preparation, shared.preparation, upsertPreparation)
      let project = { ...shared, preparation: moved.project }
      for (const definition of moved.project)
        project = sharePreparationProfile(document.manifest, project, definition.profileId)
      return {
        document: {
          ...document,
          manifest: { ...document.manifest, preparation: moved.personal },
        },
        shared: project,
      }
    })
    .exhaustive()
  const retained = {
    ...next.document,
    manifest: retainPrivatePreparationProfiles(
      next.document.manifest,
      document.manifest.profiles,
      shared.profiles,
    ),
  }
  resolveActionCatalog(retained, next.shared, '')
  validateSharedProfiles(next.shared)
  return { ...next, document: retained }
}

/** Edits replace whole definitions; fields from different revisions are never merged. */
export function editActionCatalog(
  document: LocalActionDocument,
  shared: ActionManifest,
  edit: Exclude<ActionCatalogEdit, { readonly type: 'discard-publication' }>,
) {
  if (edit.type === 'move-definition') return moveActionCatalogDefinition(document, shared, edit)
  if (edit.type === 'review-preparation') {
    const catalog = resolveActionCatalog(document, shared, '')
    const entry = catalog.preparation.find(({ definition }) => definition.id === edit.id)
    if (!entry) throw new Error('The preparation definition no longer exists.')
    const review: PreparationReview = {
      definitionId: edit.id,
      fingerprint: preparationExecutionKey(entry.definition),
      invocation: entry.definition.invocation,
      enabled: edit.enabled,
    }
    return {
      document: {
        ...document,
        reviews: [...document.reviews.filter((value) => value.definitionId !== edit.id), review],
      },
      shared,
    }
  }
  const target = edit.storage === 'local' ? document.manifest : shared
  const next = match(edit)
    .with({ type: 'save-action' }, ({ definition }) => ({
      ...target,
      actions: upsert(target.actions, definition),
    }))
    .with({ type: 'delete-action' }, ({ id }) => ({
      ...target,
      actions: target.actions.filter((definition) => definition.id !== id),
    }))
    .with({ type: 'save-profile' }, ({ definition }) => ({
      ...target,
      profiles: upsert(target.profiles, definition),
    }))
    .with({ type: 'delete-profile' }, ({ id }) => {
      if (id === 'default') throw new Error('The default preparation profile cannot be deleted.')
      if (
        resolveActionCatalog(document, shared, '').preparation.some(
          ({ definition }) => definition.profileId === id,
        )
      )
        throw new Error('Remove the profile’s setup and cleanup definitions first.')
      return { ...target, profiles: target.profiles.filter((definition) => definition.id !== id) }
    })
    .with({ type: 'save-preparation' }, ({ definition }) => ({
      ...target,
      preparation: upsertPreparation(target.preparation, definition),
    }))
    .with({ type: 'delete-preparation' }, ({ id }) => ({
      ...target,
      preparation: target.preparation.filter((definition) => definition.id !== id),
    }))
    .exhaustive()
  let nextDocument = edit.storage === 'local' ? { ...document, manifest: next } : document
  if (edit.type === 'save-action' && edit.storage === 'project') {
    nextDocument = {
      ...nextDocument,
      manifest: {
        ...nextDocument.manifest,
        actions: nextDocument.manifest.actions.filter((entry) => entry.id !== edit.definition.id),
      },
    }
  }
  let nextShared = edit.storage === 'project' ? next : shared
  if (edit.type === 'save-preparation' && edit.storage === 'project') {
    nextShared = sharePreparationProfile(document.manifest, nextShared, edit.definition.profileId)
    nextDocument = {
      ...nextDocument,
      manifest: {
        ...nextDocument.manifest,
        preparation: nextDocument.manifest.preparation.filter(
          (entry) => entry.id !== edit.definition.id,
        ),
      },
    }
  }
  // Saving a personal preparation enables precisely this execution, without trusting later shared edits.
  if (edit.type === 'save-preparation' && edit.storage === 'local') {
    const definition = edit.definition
    nextDocument = {
      ...nextDocument,
      reviews: [
        ...nextDocument.reviews.filter((review) => review.definitionId !== definition.id),
        {
          definitionId: definition.id,
          fingerprint: preparationExecutionKey(definition),
          invocation: definition.invocation,
          enabled: true,
        },
      ],
    }
  }
  nextDocument = {
    ...nextDocument,
    manifest: retainPrivatePreparationProfiles(
      nextDocument.manifest,
      document.manifest.profiles,
      shared.profiles,
    ),
  }
  resolveActionCatalog(nextDocument, nextShared, '')
  validateSharedProfiles(nextShared)
  return { document: nextDocument, shared: nextShared }
}
