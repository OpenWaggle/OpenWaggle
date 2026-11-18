import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkspaceTextEncoding } from '@shared/types/workspace-files'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { applyEditorConfigContentPolicy } from '../lib/editorconfig-policy'
import { removeDraftJournal } from '../lib/workspace-draft-journal'
import { acceptDiskDocument } from './workspace-document-recovery-actions'
import { runWorkspaceQueueOperation } from './workspace-operation-queue'
import {
  captureWorkspaceDocumentSnapshot,
  flushWorkspaceEdits,
  persistPendingJournal,
  preserveFailedDraft,
  recordWorkspaceDocumentChange,
  type WorkspaceSaveQueueContext,
} from './workspace-save-queue'

const POST_NORMALIZATION_NEXT_VERSION_OFFSET = 2

export async function normalizeWorkspaceLineEndings(
  context: WorkspaceSaveQueueContext,
  lineEnding: 'lf' | 'crlf',
) {
  await flushWorkspaceEdits(context)
  if (context.conflict.current || context.pending.current.length > 0) return
  await runWorkspaceQueueOperation(context, () =>
    applyWorkspaceLineEndingNormalization(context, lineEnding),
  )
}

async function applyWorkspaceLineEndingNormalization(
  context: WorkspaceSaveQueueContext,
  lineEnding: 'lf' | 'crlf',
) {
  const currentContent = captureWorkspaceDocumentSnapshot(context)
  const normalized = currentContent.replace(/\r\n?|\n/gu, '\n')
  const version = context.persistedVersion.current + 1
  const result = await api.applyWorkspaceDocumentEdits({
    projectPath: context.projectPath,
    path: context.file.path,
    expectedRevision: context.revision.current,
    baseVersion: context.persistedVersion.current,
    normalizeLineEnding: lineEnding,
    targetEncoding: context.encoding.current,
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
      const latestContent = captureWorkspaceDocumentSnapshot(context)
      const hasPostNormalizationEdits = latestContent !== currentContent
      context.revision.current = saved.revision
      context.persistedVersion.current = saved.version
      context.encoding.current = saved.encoding
      context.nextVersion.current =
        saved.version + (hasPostNormalizationEdits ? POST_NORMALIZATION_NEXT_VERSION_OFFSET : 1)
      context.pending.current = hasPostNormalizationEdits
        ? [
            {
              version: saved.version + 1,
              changes: [
                {
                  rangeOffset: 0,
                  rangeLength: normalized.length,
                  text: latestContent,
                },
              ],
            },
          ]
        : []
      context.latestContent.current = hasPostNormalizationEdits ? latestContent : normalized
      context.savedContent.current = normalized
      context.setEditorRevision(saved.revision)
      context.conflict.current = false
      context.setContent(hasPostNormalizationEdits ? latestContent : normalized)
      context.setSavedContent(normalized)
      context.setStatus(hasPostNormalizationEdits ? 'dirty' : 'saved')
      context.setErrorMessage(null)
      context.setNormalizationRequired(false)
      if (hasPostNormalizationEdits) {
        persistPendingJournal(context)
        context.setChangeSequence((current) => current + 1)
      } else {
        removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
      }
      context.queryClient.setQueryData(
        queryKeys.workspaceFile(context.projectPath, context.file.path),
        {
          ...context.file,
          content: normalized,
          documentVersion: saved.version,
          revision: saved.revision,
          size: saved.size,
          modifiedAt: saved.modifiedAt,
          fidelity: { ...context.file.fidelity, encoding: saved.encoding, lineEnding },
        },
      )
      context.setLineEnding(lineEnding)
    })
    .with('conflict', (failure) => preserveFailedDraft(context, failure.message, 'conflict'))
    .with('out-of-sync', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .with('too-large', (failure) => preserveFailedDraft(context, failure.message, 'error'))
    .exhaustive()
}

async function reopenWorkspaceDocumentWithEncodingNow(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
  discardDraft: boolean,
  confirmedAtEditSequence: number,
) {
  if (context.editSequence.current !== confirmedAtEditSequence) {
    persistPendingJournal(context)
    throw new Error(
      'The file changed after you confirmed reopening. Your newer edits were kept; try again.',
    )
  }
  const contentBeforeReopen = captureWorkspaceDocumentSnapshot(context)
  const hasUnsavedDraft =
    context.conflict.current ||
    context.pending.current.length > 0 ||
    contentBeforeReopen !== context.savedContent.current
  if (hasUnsavedDraft && !discardDraft) {
    persistPendingJournal(context)
    throw new Error('Save or resolve your current edits before reopening with another encoding.')
  }
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

export function reopenWorkspaceDocumentWithEncoding(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
  discardDraft = false,
) {
  const confirmedAtEditSequence = context.editSequence.current
  return runWorkspaceQueueOperation(context, () =>
    reopenWorkspaceDocumentWithEncodingNow(
      context,
      encoding,
      discardDraft,
      confirmedAtEditSequence,
    ),
  )
}

async function applyWorkspaceDocumentEncoding(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
) {
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
      context.encoding.current = saved.encoding
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

export async function saveWorkspaceDocumentWithEncoding(
  context: WorkspaceSaveQueueContext,
  encoding: WorkspaceTextEncoding,
) {
  await flushWorkspaceEdits(context)
  if (context.conflict.current || context.pending.current.length > 0) return
  await runWorkspaceQueueOperation(context, () => applyWorkspaceDocumentEncoding(context, encoding))
  if (!context.conflict.current && context.pending.current.length > 0) {
    await flushWorkspaceEdits(context)
  }
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
