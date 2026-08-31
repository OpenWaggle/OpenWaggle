import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { removeDraftJournal } from '../lib/workspace-draft-journal'
import {
  captureWorkspaceDocumentSnapshot,
  preserveFailedDraft,
  type WorkspaceSaveQueueContext,
} from './workspace-save-queue'

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

export async function reloadWorkspaceDocument(context: WorkspaceSaveQueueContext) {
  const next = await api.readWorkspaceFile(context.projectPath, context.file.path)
  if ('content' in next) acceptDiskDocument(context, next)
}

export async function compareWorkspaceDocumentWithDisk(context: WorkspaceSaveQueueContext) {
  const disk = await api.readWorkspaceFile(context.projectPath, context.file.path)
  if ('content' in disk) context.setConflictDiskContent(disk.content)
}

export async function restoreWorkspaceDraftOverDisk(context: WorkspaceSaveQueueContext) {
  const draft = captureWorkspaceDocumentSnapshot(context)
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
      context.revision.current = saved.revision
      context.persistedVersion.current = saved.version
      context.nextVersion.current = saved.version + 1
      context.pending.current = []
      context.conflict.current = false
      context.savedContent.current = draft
      context.setEditorRevision(saved.revision)
      context.setSavedContent(draft)
      context.setStatus('saved')
      context.setErrorMessage(null)
      context.setConflictDiskContent(null)
      removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
      context.queryClient.setQueryData(
        queryKeys.workspaceFile(context.projectPath, context.file.path),
        {
          ...disk,
          content: draft,
          documentVersion: saved.version,
          revision: saved.revision,
          size: saved.size,
          modifiedAt: saved.modifiedAt,
        },
      )
    })
    .with('conflict', (failure) => preserveFailedDraft(context, failure.message, 'conflict'))
    .with('out-of-sync', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .with('too-large', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .exhaustive()
}
