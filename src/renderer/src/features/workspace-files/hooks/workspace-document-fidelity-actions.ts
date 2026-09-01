import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkspaceTextEncoding } from '@shared/types/workspace-files'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { applyEditorConfigContentPolicy } from '../lib/editorconfig-policy'
import { removeDraftJournal } from '../lib/workspace-draft-journal'
import { acceptDiskDocument } from './workspace-document-recovery-actions'
import {
  captureWorkspaceDocumentSnapshot,
  flushWorkspaceEdits,
  persistPendingJournal,
  preserveFailedDraft,
  recordWorkspaceDocumentChange,
  type WorkspaceSaveQueueContext,
} from './workspace-save-queue'

export async function normalizeWorkspaceLineEndings(
  context: WorkspaceSaveQueueContext,
  lineEnding: 'lf' | 'crlf',
) {
  await flushWorkspaceEdits(context)
  if (context.conflict.current || context.pending.current.length > 0) return
  const currentContent = captureWorkspaceDocumentSnapshot(context)
  const normalized = currentContent.replace(/\r\n?|\n/gu, '\n')
  const version = context.persistedVersion.current + 1
  const result = await api.applyWorkspaceDocumentEdits({
    projectPath: context.projectPath,
    path: context.file.path,
    expectedRevision: context.revision.current,
    baseVersion: context.persistedVersion.current,
    normalizeLineEnding: lineEnding,
    targetEncoding: context.file.fidelity.encoding,
    batches: [
      {
        version,
        changes: [
          {
            rangeOffset: 0,
            rangeLength: currentContent.length,
            text: normalized,
          },
        ],
      },
    ],
  })
  matchBy(result, 'status')
    .with('saved', (saved) => {
      context.revision.current = saved.revision
      context.persistedVersion.current = saved.version
      context.nextVersion.current = saved.version + 1
      context.pending.current = []
      context.latestContent.current = normalized
      context.savedContent.current = normalized
      context.setEditorRevision(saved.revision)
      context.conflict.current = false
      context.setContent(normalized)
      context.setSavedContent(normalized)
      context.setStatus('saved')
      context.setErrorMessage(null)
      context.setNormalizationRequired(false)
      removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
      context.queryClient.setQueryData(
        queryKeys.workspaceFile(context.projectPath, context.file.path),
        {
          ...context.file,
          content: normalized,
          documentVersion: saved.version,
          revision: saved.revision,
          size: saved.size,
          modifiedAt: saved.modifiedAt,
          fidelity: { ...context.file.fidelity, lineEnding },
        },
      )
      context.setLineEnding(lineEnding)
    })
    .with('conflict', (failure) => preserveFailedDraft(context, failure.message, 'conflict'))
    .with('out-of-sync', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .with('too-large', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .exhaustive()
}

export async function reopenWorkspaceDocumentWithEncoding(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
) {
  const contentBeforeReopen = captureWorkspaceDocumentSnapshot(context)
  const next = await api.readWorkspaceFileWithEncoding(
    context.projectPath,
    context.file.path,
    encoding,
  )
  if (!('content' in next)) throw new Error('The file could not be decoded with that encoding.')
  if (captureWorkspaceDocumentSnapshot(context) !== contentBeforeReopen) {
    persistPendingJournal(context)
    throw new Error('The file changed while reopening. Your newer edits were kept; try again.')
  }
  acceptDiskDocument(context, next)
}

export async function saveWorkspaceDocumentWithEncoding(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
) {
  await flushWorkspaceEdits(context)
  if (context.conflict.current || context.pending.current.length > 0) return
  const result = await api.applyWorkspaceDocumentEdits({
    projectPath: context.projectPath,
    path: context.file.path,
    expectedRevision: context.revision.current,
    baseVersion: context.persistedVersion.current,
    batches: [],
    targetEncoding: encoding,
  })
  matchBy(result, 'status')
    .with('saved', (saved) => {
      context.revision.current = saved.revision
      context.persistedVersion.current = saved.version
      context.setEncoding(saved.encoding)
      context.setLineEnding(saved.lineEnding)
      context.setStatus('saved')
      context.queryClient.setQueryData(
        queryKeys.workspaceFile(context.projectPath, context.file.path),
        {
          ...context.file,
          content: context.latestContent.current,
          documentVersion: saved.version,
          revision: saved.revision,
          size: saved.size,
          modifiedAt: saved.modifiedAt,
          fidelity: {
            ...context.file.fidelity,
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

export async function saveWorkspaceDocumentSnapshot(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
) {
  await flushWorkspaceEdits(context)
  if (context.conflict.current || context.pending.current.length > 0) return
  const policy = context.file.fidelity.editorConfigPolicy
  const currentContent = captureWorkspaceDocumentSnapshot(context)
  const nextContent = applyEditorConfigContentPolicy(currentContent, policy)
  if (nextContent !== currentContent) {
    recordWorkspaceDocumentChange(
      context,
      [
        {
          rangeOffset: 0,
          rangeLength: currentContent.length,
          text: nextContent,
        },
      ],
      () => nextContent,
    )
    await flushWorkspaceEdits(context)
    return
  }
  if (policy?.encoding || policy?.lineEnding) {
    await saveWorkspaceDocumentWithEncoding(context, policy.encoding ?? encoding)
  }
}
