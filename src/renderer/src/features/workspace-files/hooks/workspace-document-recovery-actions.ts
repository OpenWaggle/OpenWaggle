import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { removeDraftJournal } from '../lib/workspace-draft-journal'
import { runWorkspaceQueueOperation } from './workspace-operation-queue'
import {
  captureWorkspaceDocumentSnapshot,
  persistPendingJournal,
  preserveFailedDraft,
  type WorkspaceSaveQueueContext,
} from './workspace-save-queue'

const POST_RESTORE_NEXT_VERSION_OFFSET = 2

export function acceptDiskDocument(
  context: WorkspaceSaveQueueContext,
  next: WorkspaceTextFileReadResult,
) {
  context.conflict.current = false
  context.revision.current = next.revision
  context.persistedVersion.current = next.documentVersion
  context.nextVersion.current = next.documentVersion + 1
  context.pending.current = []
  context.latestContent.current = next.content
  context.latestSnapshot.current = null
  context.savedContent.current = next.content
  context.encoding.current = next.fidelity.encoding
  context.setEditorRevision(next.revision)
  context.setContent(next.content)
  context.setSavedContent(next.content)
  context.setStatus('saved')
  context.setErrorMessage(null)
  context.setConflictDiskContent(null)
  context.setNormalizationRequired(next.fidelity.lineEnding === 'mixed')
  context.setEncoding(next.fidelity.encoding)
  context.setLineEnding(next.fidelity.lineEnding)
  removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
  context.queryClient.setQueryData(
    queryKeys.workspaceFile(context.projectPath, context.file.path),
    next,
  )
}

async function reloadWorkspaceDocumentNow(context: WorkspaceSaveQueueContext) {
  const contentBeforeReload = captureWorkspaceDocumentSnapshot(context)
  const next = await api.readWorkspaceFile(context.projectPath, context.file.path)
  if (!('content' in next)) return
  if (captureWorkspaceDocumentSnapshot(context) !== contentBeforeReload) {
    persistPendingJournal(context)
    throw new Error('The file changed while loading disk content. Your newer edits were kept.')
  }
  acceptDiskDocument(context, next)
}

export function reloadWorkspaceDocument(context: WorkspaceSaveQueueContext) {
  return runWorkspaceQueueOperation(context, () => reloadWorkspaceDocumentNow(context))
}

export async function compareWorkspaceDocumentWithDisk(context: WorkspaceSaveQueueContext) {
  const disk = await api.readWorkspaceFile(context.projectPath, context.file.path)
  if ('content' in disk) context.setConflictDiskContent(disk.content)
}

async function restoreWorkspaceDraftOverDiskNow(context: WorkspaceSaveQueueContext, draft: string) {
  context.latestContent.current = draft
  context.latestSnapshot.current = null
  if (context.mounted.current) context.setContent(draft)
  const disk = await api.readWorkspaceFile(context.projectPath, context.file.path)
  if (!('content' in disk)) return
  const version = disk.documentVersion + 1
  const result = await api.applyWorkspaceDocumentEdits({
    projectPath: context.projectPath,
    path: context.file.path,
    expectedRevision: disk.revision,
    baseVersion: disk.documentVersion,
    batches: [
      {
        version,
        changes: [{ rangeOffset: 0, rangeLength: disk.content.length, text: draft }],
      },
    ],
  })
  matchBy(result, 'status')
    .with('saved', (saved) => {
      const latestDraft = captureWorkspaceDocumentSnapshot(context)
      const hasPostRestoreEdits = latestDraft !== draft
      context.revision.current = saved.revision
      context.persistedVersion.current = saved.version
      context.nextVersion.current =
        saved.version + (hasPostRestoreEdits ? POST_RESTORE_NEXT_VERSION_OFFSET : 1)
      context.pending.current = hasPostRestoreEdits
        ? [
            {
              version: saved.version + 1,
              changes: [{ rangeOffset: 0, rangeLength: draft.length, text: latestDraft }],
            },
          ]
        : []
      context.conflict.current = false
      context.latestContent.current = latestDraft
      context.latestSnapshot.current = null
      context.savedContent.current = draft
      context.encoding.current = saved.encoding
      context.setContent(latestDraft)
      context.setEditorRevision(saved.revision)
      context.setSavedContent(draft)
      context.setEncoding(saved.encoding)
      context.setLineEnding(saved.lineEnding)
      context.setStatus(hasPostRestoreEdits ? 'dirty' : 'saved')
      context.setErrorMessage(null)
      context.setConflictDiskContent(null)
      if (hasPostRestoreEdits) {
        persistPendingJournal(context)
        context.setChangeSequence((current) => current + 1)
      } else {
        removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
      }
      context.queryClient.setQueryData(
        queryKeys.workspaceFile(context.projectPath, context.file.path),
        {
          ...disk,
          content: draft,
          documentVersion: saved.version,
          revision: saved.revision,
          size: saved.size,
          modifiedAt: saved.modifiedAt,
          fidelity: {
            ...disk.fidelity,
            encoding: saved.encoding,
            lineEnding: saved.lineEnding,
          },
        },
      )
    })
    .with('conflict', (failure) => preserveFailedDraft(context, failure.message, 'conflict'))
    .with('out-of-sync', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .with('too-large', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .exhaustive()
}

export function restoreWorkspaceDraftOverDisk(context: WorkspaceSaveQueueContext) {
  const selectedDraft = captureWorkspaceDocumentSnapshot(context)
  return runWorkspaceQueueOperation(context, () =>
    restoreWorkspaceDraftOverDiskNow(context, selectedDraft),
  )
}
