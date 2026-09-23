import { realpath } from 'node:fs/promises'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { actionCatalogEditSchema, actionManifestSchema } from '@shared/schemas/action-definitions'
import type { ActionCatalogEdit, PreparationReview } from '@shared/types/action-definitions'
import { enqueueProjectConfigWrite } from '../../config/project-config-write-queue'
import {
  editActionCatalog,
  type PendingActionPublication,
  resolveActionCatalog,
} from '../../domain/project-action-catalog'
import type { ActionCatalogScope } from '../../ports/action-catalog-service'
import {
  actionContentRevision,
  readActionManifest,
  readActionWorkspaceIdentity,
} from './action-manifest-file'
import { actionPublicationPath, createActionPublication } from './action-publication-files'
import { recoverActionPublication } from './action-publication-recovery'
import { migrateLegacyActionDocument } from './legacy-action-migration'
import {
  type ActionStatePersistence,
  localActionDocumentSchema,
  localActionStateSchema,
  type StoredActionState,
} from './local-action-state'

function publicationDetails(pending: PendingActionPublication) {
  return {
    workspacePath: pending.workspacePath,
    ...(pending.publication
      ? { recoveryPath: actionPublicationPath(pending.workspacePath, pending.publication.id) }
      : {}),
    projectDraft: pending.nextShared,
    localDraft: pending.nextLocal.manifest,
  }
}

async function restorePreparationReviewState(
  persistence: ActionStatePersistence,
  projectPath: string,
  stored: StoredActionState,
  revision: string,
  expectedRevision: string,
  definitionId: string,
  previous: PreparationReview | undefined,
) {
  if (revision !== expectedRevision || stored.state.pending)
    throw new Error(
      'Project Actions changed while undoing a failed preparation review. Reload and review the shared setup.',
    )
  const document = decodeUnknownExactOrThrow(localActionDocumentSchema, {
    ...stored.state.document,
    reviews: [
      ...stored.state.document.reviews.filter((review) => review.definitionId !== definitionId),
      ...(previous ? [previous] : []),
    ],
  })
  await persistence.write(projectPath, stored.revision, { document, pending: null })
}

async function serializedActionCatalog<T>(
  scope: ActionCatalogScope,
  operation: (canonical: ActionCatalogScope) => Promise<T>,
): Promise<T> {
  const [projectPath, workspacePath] = await Promise.all([
    realpath(scope.projectPath),
    realpath(scope.workspacePath),
  ])
  return enqueueProjectConfigWrite(`actions:${projectPath}`, () =>
    operation({ projectPath, workspacePath }),
  )
}

export function createActionCatalog(persistence: ActionStatePersistence) {
  async function load(scope: ActionCatalogScope) {
    const workspaceIdentity = await readActionWorkspaceIdentity(scope.workspacePath)
    if (!workspaceIdentity)
      throw new Error('This Project Actions Workspace is no longer available.')
    let stored = await persistence.read(scope.projectPath)
    if (!stored) {
      const document = decodeUnknownExactOrThrow(
        localActionDocumentSchema,
        await migrateLegacyActionDocument(scope.projectPath),
      )
      await persistence.write(scope.projectPath, 0, { document, pending: null })
      // Re-read the committed destination before treating migration as complete.
      const verified = await persistence.read(scope.projectPath)
      if (!verified || JSON.stringify(verified.state.document) !== JSON.stringify(document))
        throw new Error(
          'Project Actions migration could not be verified. Legacy settings remain intact.',
        )
      stored = verified
    }
    stored = await recoverActionPublication(persistence, scope.projectPath, stored)
    const shared = await readActionManifest(scope.workspacePath)
    const revision = actionContentRevision(
      `${scope.workspacePath}:${JSON.stringify(workspaceIdentity)}:${stored.revision}:${shared.revision}`,
    )
    return { stored, shared, revision, workspaceIdentity }
  }

  async function readCurrent(scope: ActionCatalogScope) {
    const { stored, shared, revision } = await load(scope)
    const catalog = resolveActionCatalog(stored.state.document, shared.manifest, revision)
    const pending = stored.state.pending
    return pending ? { ...catalog, pendingPublication: publicationDetails(pending) } : catalog
  }

  return {
    read: (scope: ActionCatalogScope) => serializedActionCatalog(scope, readCurrent),
    restorePreparationReview: (
      scope: ActionCatalogScope,
      expectedRevision: string,
      definitionId: string,
      previous: PreparationReview | undefined,
    ) =>
      serializedActionCatalog(scope, async (canonical) => {
        const { stored, revision } = await load(canonical)
        await restorePreparationReviewState(
          persistence,
          canonical.projectPath,
          stored,
          revision,
          expectedRevision,
          definitionId,
          previous,
        )
        return readCurrent(canonical)
      }),
    edit: (scope: ActionCatalogScope, expectedRevision: string, rawEdit: ActionCatalogEdit) =>
      serializedActionCatalog(scope, async (canonical) => {
        const edit = decodeUnknownExactOrThrow(actionCatalogEditSchema, rawEdit)
        const { stored, shared, revision, workspaceIdentity } = await load(canonical)
        if (revision !== expectedRevision)
          throw new Error(
            'Project Actions changed since this editor was opened. Your draft has been kept; reload before saving.',
          )
        if (edit.type === 'discard-publication') {
          await persistence.write(canonical.projectPath, stored.revision, {
            document: stored.state.document,
            pending: null,
          })
          return readCurrent(canonical)
        }
        if (stored.state.pending)
          throw new Error(
            'An interrupted save conflicts with an external edit. Review the retained drafts before discarding the pending publication.',
          )
        const next = editActionCatalog(stored.state.document, shared.manifest, edit)
        decodeUnknownExactOrThrow(localActionDocumentSchema, next.document)
        decodeUnknownExactOrThrow(actionManifestSchema, next.shared)
        if (JSON.stringify(next.shared) === JSON.stringify(shared.manifest)) {
          await persistence.write(canonical.projectPath, stored.revision, {
            document: next.document,
            pending: null,
          })
        } else {
          const resource = await persistence.readWorkspace(
            canonical.projectPath,
            canonical.workspacePath,
          )
          if (resource && !resource.ready)
            throw new Error(
              'This Project Actions Workspace is no longer available. Your draft has been kept.',
            )
          const publication = await createActionPublication(canonical.workspacePath, async () => {
            const current = await readActionWorkspaceIdentity(canonical.workspacePath)
            if (JSON.stringify(current) !== JSON.stringify(workspaceIdentity))
              throw new Error('The publication Workspace changed. Your draft has been kept.')
          })
          const pending = decodeUnknownExactOrThrow(localActionStateSchema, {
            document: stored.state.document,
            pending: {
              workspacePath: canonical.workspacePath,
              publication,
              workspaceIdentity: { ...workspaceIdentity, resourceId: resource?.id ?? null },
              previousSharedRevision: shared.revision,
              nextShared: next.shared,
              nextLocal: next.document,
            },
          })
          const journaled = await persistence.write(canonical.projectPath, stored.revision, pending)
          await recoverActionPublication(persistence, canonical.projectPath, journaled)
        }
        return readCurrent(canonical)
      }),
  }
}
