import { realpath } from 'node:fs/promises'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { actionCatalogEditSchema, actionManifestSchema } from '@shared/schemas/action-definitions'
import type { ActionCatalogEdit } from '@shared/types/action-definitions'
import { enqueueProjectConfigWrite } from '../../config/project-config-write-queue'
import { editActionCatalog, resolveActionCatalog } from '../../domain/project-action-catalog'
import type { ActionCatalogScope } from '../../ports/action-catalog-service'
import {
  actionContentRevision,
  readActionManifest,
  serializeActionManifest,
  writeActionManifest,
} from './action-manifest-file'
import { migrateLegacyActionDocument } from './legacy-action-migration'
import {
  type ActionStatePersistence,
  localActionDocumentSchema,
  localActionStateSchema,
  type StoredActionState,
} from './local-action-state'

export function createActionCatalog(persistence: ActionStatePersistence) {
  async function recover(
    projectPath: string,
    stored: StoredActionState,
  ): Promise<StoredActionState> {
    const pending = stored.state.pending
    if (!pending) return stored
    const current = await readActionManifest(pending.workspacePath)
    const targetRevision = actionContentRevision(serializeActionManifest(pending.nextShared))
    if (current.revision !== targetRevision) {
      if (current.revision !== pending.previousSharedRevision) return stored // Expose both drafts so the editor can resolve the conflict without data loss.
      await writeActionManifest(
        pending.workspacePath,
        pending.previousSharedRevision,
        pending.nextShared,
      )
    }
    return persistence.write(projectPath, stored.revision, {
      document: pending.nextLocal,
      pending: null,
    })
  }

  async function load(scope: ActionCatalogScope) {
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
    stored = await recover(scope.projectPath, stored)
    const shared = await readActionManifest(scope.workspacePath)
    const revision = actionContentRevision(
      `${scope.workspacePath}:${stored.revision}:${shared.revision}`,
    )
    return { stored, shared, revision }
  }

  async function serialized<T>(
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

  async function readCurrent(scope: ActionCatalogScope) {
    const { stored, shared, revision } = await load(scope)
    const catalog = resolveActionCatalog(stored.state.document, shared.manifest, revision)
    const pending = stored.state.pending
    return pending
      ? {
          ...catalog,
          pendingPublication: {
            workspacePath: pending.workspacePath,
            projectDraft: pending.nextShared,
            localDraft: pending.nextLocal.manifest,
          },
        }
      : catalog
  }

  return {
    read: (scope: ActionCatalogScope) => serialized(scope, readCurrent),
    edit: (scope: ActionCatalogScope, expectedRevision: string, rawEdit: ActionCatalogEdit) =>
      serialized(scope, async (canonical) => {
        const edit = decodeUnknownExactOrThrow(actionCatalogEditSchema, rawEdit)
        const { stored, shared, revision } = await load(canonical)
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
          const pending = decodeUnknownExactOrThrow(localActionStateSchema, {
            document: stored.state.document,
            pending: {
              workspacePath: canonical.workspacePath,
              previousSharedRevision: shared.revision,
              nextShared: next.shared,
              nextLocal: next.document,
            },
          })
          const journaled = await persistence.write(canonical.projectPath, stored.revision, pending)
          await recover(canonical.projectPath, journaled)
        }
        return readCurrent(canonical)
      }),
  }
}
