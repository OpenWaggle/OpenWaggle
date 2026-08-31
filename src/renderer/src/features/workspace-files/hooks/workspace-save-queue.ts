import { matchBy } from '@diegogbrisa/ts-match'
import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type {
  WorkspaceDocumentChange,
  WorkspaceDocumentEditBatch,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import {
  draftStorageKey,
  type PersistedDraftJournal,
  removeDraftJournal,
} from '../lib/workspace-draft-journal'

export const AUTOSAVE_DELAY_MS = 500
const MAX_PROJECTED_SAVE_COPY_CODE_UNITS = 8 * 1024 * 1024

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

interface MutableCell<T> {
  current: T
}

export interface WorkspaceSaveQueueContext {
  readonly projectPath: string
  readonly file: WorkspaceTextFileReadResult
  readonly queryClient: QueryClient
  readonly revision: MutableCell<string>
  readonly persistedVersion: MutableCell<number>
  readonly nextVersion: MutableCell<number>
  readonly latestContent: MutableCell<string>
  readonly latestSnapshot: MutableCell<(() => string) | null>
  readonly savedContent: MutableCell<string>
  readonly saving: MutableCell<boolean>
  readonly inFlight: MutableCell<Promise<void> | null>
  readonly pending: MutableCell<WorkspaceDocumentEditBatch[]>
  readonly conflict: MutableCell<boolean>
  readonly mounted: MutableCell<boolean>
  readonly setContent: Dispatch<SetStateAction<string>>
  readonly setSavedContent: Dispatch<SetStateAction<string>>
  readonly setStatus: Dispatch<SetStateAction<SaveStatus>>
  readonly setErrorMessage: Dispatch<SetStateAction<string | null>>
  readonly setConflictDiskContent: Dispatch<SetStateAction<string | null>>
  readonly setNormalizationRequired: Dispatch<SetStateAction<boolean>>
  readonly setEncoding: Dispatch<
    SetStateAction<WorkspaceTextFileReadResult['fidelity']['encoding']>
  >
  readonly setLineEnding: Dispatch<
    SetStateAction<WorkspaceTextFileReadResult['fidelity']['lineEnding']>
  >
  readonly setEditorRevision: Dispatch<SetStateAction<string>>
  readonly setChangeSequence: Dispatch<SetStateAction<number>>
}

export function captureWorkspaceDocumentSnapshot(context: WorkspaceSaveQueueContext) {
  const content = context.latestSnapshot.current?.() ?? context.latestContent.current
  context.latestContent.current = content
  if (context.mounted.current) context.setContent(content)
  return content
}

export function initialSaveQueueState(
  file: WorkspaceTextFileReadResult,
  journal: PersistedDraftJournal | null,
) {
  const recoveredOnSameBaseline = journal?.baselineRevision === file.revision
  const recoveredContent = journal?.content ?? file.content
  const content = journal ? recoveredContent : file.content
  let status: SaveStatus = 'saved'
  let errorMessage: string | null = null
  if (journal) {
    status = recoveredOnSameBaseline && !journal.conflicted ? 'dirty' : 'conflict'
    if (status === 'conflict') {
      errorMessage =
        'A recovered draft conflicts with the current disk version. Compare before restoring it.'
    }
  }
  const batches =
    recoveredOnSameBaseline && journal && recoveredContent !== file.content
      ? [
          {
            version: file.documentVersion + 1,
            changes: [{ rangeOffset: 0, rangeLength: file.content.length, text: recoveredContent }],
          },
        ]
      : []
  const lastVersion = batches.at(-1)?.version ?? file.documentVersion
  return { recoveredOnSameBaseline, content, status, errorMessage, batches, lastVersion }
}

export function persistPendingJournal(context: WorkspaceSaveQueueContext) {
  const content = captureWorkspaceDocumentSnapshot(context)
  if (
    !context.conflict.current &&
    context.pending.current.length === 0 &&
    content === context.savedContent.current
  ) {
    removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
    return
  }
  const serialized = JSON.stringify({
    baselineRevision: context.revision.current,
    baseVersion: context.persistedVersion.current,
    content,
    // The full snapshot is authoritative. Reconstruct one replacement batch
    // against the newly opened document session during recovery.
    batches: [],
    conflicted: context.conflict.current,
  } satisfies PersistedDraftJournal)
  if (serialized.length > WORKSPACE_EDITOR_PERFORMANCE.DRAFT_JOURNAL_MAX_CHARACTERS) {
    removeDraftJournal(window.localStorage, context.projectPath, context.file.path)
    if (context.mounted.current) {
      context.setErrorMessage(
        'The recovery journal reached its local safety limit. Save now to clear it.',
      )
    }
    return
  }
  try {
    window.localStorage.setItem(draftStorageKey(context.projectPath, context.file.path), serialized)
  } catch (error) {
    if (context.mounted.current) {
      context.setErrorMessage(
        error instanceof Error ? error.message : 'Could not persist the edit journal.',
      )
    }
  }
}

export function preserveFailedDraft(
  context: WorkspaceSaveQueueContext,
  message: string,
  nextStatus: Extract<SaveStatus, 'conflict' | 'error'>,
) {
  context.conflict.current = nextStatus === 'conflict'
  persistPendingJournal(context)
  if (context.mounted.current) {
    context.setErrorMessage(message)
    context.setStatus(nextStatus)
    return
  }
  useUIStore.getState().showToast(`Could not save ${context.file.basename}: ${message}`, 'error')
}

export function takeWorkspaceEditBatchesForSave(
  context: WorkspaceSaveQueueContext,
  savingContent: string,
) {
  const changeCount = context.pending.current.reduce(
    (total, batch) => total + batch.changes.length,
    0,
  )
  const projectedCopyCodeUnits = context.pending.current.length * savingContent.length
  if (
    context.pending.current.length <= WORKSPACE_FILES.DOCUMENT_EDIT_BATCH_LIMIT &&
    changeCount <= WORKSPACE_FILES.DOCUMENT_EDIT_CHANGE_LIMIT &&
    projectedCopyCodeUnits <= MAX_PROJECTED_SAVE_COPY_CODE_UNITS
  ) {
    return context.pending.current.splice(0)
  }
  const version = context.persistedVersion.current + 1
  context.pending.current = []
  context.nextVersion.current = version + 1
  return [
    {
      version,
      changes: [
        {
          rangeOffset: 0,
          rangeLength: context.savedContent.current.length,
          text: savingContent,
        },
      ],
    },
  ]
}

function cacheSavedWorkspaceFile(
  context: WorkspaceSaveQueueContext,
  savedContent: string,
  result: {
    readonly version: number
    readonly size: number
    readonly modifiedAt: number
    readonly revision: string
    readonly encoding: WorkspaceTextFileReadResult['fidelity']['encoding']
    readonly lineEnding: WorkspaceTextFileReadResult['fidelity']['lineEnding']
  },
) {
  context.queryClient.setQueryData(
    queryKeys.workspaceFile(context.projectPath, context.file.path),
    {
      ...context.file,
      content: savedContent,
      documentVersion: result.version,
      size: result.size,
      modifiedAt: result.modifiedAt,
      revision: result.revision,
      fidelity: {
        ...context.file.fidelity,
        encoding: result.encoding,
        lineEnding: result.lineEnding,
      },
    },
  )
}

export async function flushWorkspaceEdits(context: WorkspaceSaveQueueContext) {
  if (context.conflict.current) {
    throw new Error('Resolve the file conflict before continuing.')
  }
  if (context.inFlight.current) return context.inFlight.current
  if (context.pending.current.length === 0) return
  const operation = flushWorkspaceEditLoop(context)
  context.inFlight.current = operation
  try {
    await operation
  } finally {
    if (context.inFlight.current === operation) context.inFlight.current = null
  }
}

async function flushWorkspaceEditLoop(context: WorkspaceSaveQueueContext) {
  context.saving.current = true
  try {
    while (context.pending.current.length > 0 && !context.conflict.current) {
      const savingContent = captureWorkspaceDocumentSnapshot(context)
      const batches = takeWorkspaceEditBatchesForSave(context, savingContent)
      if (context.mounted.current) {
        context.setStatus('saving')
        context.setErrorMessage(null)
      }
      let result: Awaited<ReturnType<typeof api.applyWorkspaceDocumentEdits>>
      try {
        result = await api.applyWorkspaceDocumentEdits({
          projectPath: context.projectPath,
          path: context.file.path,
          expectedRevision: context.revision.current,
          baseVersion: context.persistedVersion.current,
          batches,
        })
      } catch (error) {
        context.pending.current.unshift(...batches)
        const message = error instanceof Error ? error.message : String(error)
        preserveFailedDraft(context, message, 'error')
        throw new Error(message, { cause: error })
      }

      const failureMessage = matchBy(result, 'status')
        .with('saved', (savedResult) => {
          context.revision.current = savedResult.revision
          context.persistedVersion.current = savedResult.version
          context.savedContent.current = savingContent
          if (context.mounted.current) context.setSavedContent(savingContent)
          cacheSavedWorkspaceFile(context, savingContent, savedResult)
          if (context.mounted.current) {
            context.setEncoding(savedResult.encoding)
            context.setLineEnding(savedResult.lineEnding)
          }
          persistPendingJournal(context)
          if (context.mounted.current) {
            context.setStatus(context.pending.current.length === 0 ? 'saved' : 'dirty')
          }
          return null
        })
        .with('conflict', (failure) => {
          context.pending.current.unshift(...batches)
          preserveFailedDraft(context, failure.message, 'conflict')
          return failure.message
        })
        .with('out-of-sync', (failure) => {
          context.pending.current.unshift(...batches)
          preserveFailedDraft(context, failure.message, 'error')
          return failure.message
        })
        .with('too-large', (failure) => {
          context.pending.current.unshift(...batches)
          preserveFailedDraft(context, failure.message, 'error')
          return failure.message
        })
        .exhaustive()
      if (failureMessage !== null) throw new Error(failureMessage)
    }
  } finally {
    context.saving.current = false
  }
}

export function recordWorkspaceDocumentChange(
  context: WorkspaceSaveQueueContext,
  changes: readonly WorkspaceDocumentChange[],
  readSource: () => string,
) {
  if (changes.length === 0) return
  context.latestSnapshot.current = readSource
  if (context.conflict.current) {
    context.setChangeSequence((current) => current + 1)
    return
  }
  context.pending.current.push({ version: context.nextVersion.current, changes })
  context.nextVersion.current += 1
  context.setStatus('dirty')
  context.setChangeSequence((current) => current + 1)
}
