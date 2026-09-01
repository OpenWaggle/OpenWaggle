import type {
  WorkspaceDocumentChange,
  WorkspaceTextEncoding,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { readDraftJournal } from '../lib/workspace-draft-journal'
import { registerWorkspaceEditorSave } from '../lib/workspace-editor-save-coordinator'
import {
  normalizeWorkspaceLineEndings,
  reopenWorkspaceDocumentWithEncoding,
  saveWorkspaceDocumentSnapshot,
  saveWorkspaceDocumentWithEncoding,
} from './workspace-document-fidelity-actions'
import {
  compareWorkspaceDocumentWithDisk,
  reloadWorkspaceDocument,
  restoreWorkspaceDraftOverDisk,
} from './workspace-document-recovery-actions'
import {
  AUTOSAVE_DELAY_MS,
  captureWorkspaceDocumentSnapshot,
  flushWorkspaceEdits,
  initialSaveQueueState,
  persistPendingJournal,
  recordWorkspaceDocumentChange,
  type SaveStatus,
  type WorkspaceSaveQueueContext,
} from './workspace-save-queue'

function useSaveQueueValues(projectPath: string, file: WorkspaceTextFileReadResult) {
  const queryClient = useQueryClient()
  const [initial] = useState(() =>
    initialSaveQueueState(file, readDraftJournal(window.localStorage, projectPath, file.path)),
  )
  const [content, setContent] = useState(initial.content)
  const [savedContent, setSavedContent] = useState(file.content)
  const [status, setStatus] = useState<SaveStatus>(initial.status)
  const [errorMessage, setErrorMessage] = useState<string | null>(initial.errorMessage)
  const [conflictDiskContent, setConflictDiskContent] = useState<string | null>(null)
  const [normalizationRequired, setNormalizationRequired] = useState(
    file.fidelity.lineEnding === 'mixed',
  )
  const [encoding, setEncoding] = useState(file.fidelity.encoding)
  const [lineEnding, setLineEnding] = useState(file.fidelity.lineEnding)
  const [editorRevision, setEditorRevision] = useState(file.revision)
  const [changeSequence, setChangeSequence] = useState(initial.batches.length > 0 ? 1 : 0)
  const revision = useRef(file.revision)
  const persistedVersion = useRef(file.documentVersion)
  const nextVersion = useRef(initial.lastVersion + 1)
  const latestContent = useRef(initial.content)
  const latestSnapshot = useRef<(() => string) | null>(null)
  const savedContentRef = useRef(file.content)
  const encodingRef = useRef(file.fidelity.encoding)
  const saving = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(initial.batches)
  const conflict = useRef(initial.status === 'conflict')
  const mounted = useRef(true)
  const context: WorkspaceSaveQueueContext = {
    projectPath,
    file,
    queryClient,
    revision,
    persistedVersion,
    nextVersion,
    latestContent,
    latestSnapshot,
    savedContent: savedContentRef,
    encoding: encodingRef,
    saving,
    inFlight,
    pending,
    conflict,
    mounted,
    setContent,
    setSavedContent,
    setStatus,
    setErrorMessage,
    setConflictDiskContent,
    setNormalizationRequired,
    setEncoding,
    setLineEnding,
    setEditorRevision,
    setChangeSequence,
  }
  return {
    context,
    state: {
      content,
      savedContent,
      status,
      errorMessage,
      conflictDiskContent,
      normalizationRequired,
      encoding,
      lineEnding,
      editorRevision,
      changeSequence,
    },
  }
}

function useSaveQueueLifecycle(context: WorkspaceSaveQueueContext, changeSequence: number) {
  const flushFromEffect = useEffectEvent(() => flushWorkspaceEdits(context))
  const persistFromEffect = useEffectEvent(() => persistPendingJournal(context))
  const synchronizeFromEffect = useEffectEvent((file: WorkspaceTextFileReadResult) => {
    if (file.revision === context.revision.current) return
    if (
      context.pending.current.length > 0 ||
      context.latestContent.current !== context.savedContent.current
    ) {
      context.conflict.current = true
      context.setStatus('conflict')
      context.setErrorMessage(
        'The file changed on disk. Compare it with your draft before choosing a version.',
      )
      persistFromEffect()
      return
    }
    context.revision.current = file.revision
    context.persistedVersion.current = file.documentVersion
    context.nextVersion.current = file.documentVersion + 1
    context.latestContent.current = file.content
    context.latestSnapshot.current = null
    context.savedContent.current = file.content
    context.encoding.current = file.fidelity.encoding
    context.setEditorRevision(file.revision)
    context.setContent(file.content)
    context.setSavedContent(file.content)
    context.setNormalizationRequired(file.fidelity.lineEnding === 'mixed')
    context.setEncoding(file.fidelity.encoding)
    context.setLineEnding(file.fidelity.lineEnding)
  })

  useEffect(() => {
    if (changeSequence === 0) return
    const timer = window.setTimeout(() => {
      persistFromEffect()
      void flushFromEffect().catch(() => undefined)
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [changeSequence])

  const mounted = context.mounted
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      persistFromEffect()
      void flushFromEffect().catch(() => undefined)
    }
  }, [mounted])

  const file = context.file
  useEffect(() => {
    synchronizeFromEffect(file)
  }, [file])

  const projectPath = context.projectPath
  useEffect(
    () =>
      registerWorkspaceEditorSave({
        projectPath,
        filePath: file.path,
        flush: () => flushFromEffect(),
      }),
    [file.path, projectPath],
  )
}

export function useWorkspaceFileSaveQueue(projectPath: string, file: WorkspaceTextFileReadResult) {
  const { context, state } = useSaveQueueValues(projectPath, file)
  useSaveQueueLifecycle(context, state.changeSequence)

  return {
    content: state.content,
    conflictDiskContent: state.conflictDiskContent,
    compareWithDisk: () => compareWorkspaceDocumentWithDisk(context),
    dismissComparison: () => context.setConflictDiskContent(null),
    errorMessage: state.errorMessage,
    encoding: state.encoding,
    editorRevision: state.editorRevision,
    captureSnapshot: () => captureWorkspaceDocumentSnapshot(context),
    handleChange: (changes: readonly WorkspaceDocumentChange[], readSource: () => string) =>
      recordWorkspaceDocumentChange(context, changes, readSource),
    reloadFromDisk: () => reloadWorkspaceDocument(context),
    reopenWithEncoding: (encoding: WorkspaceTextEncoding, discardDraft = false) =>
      reopenWorkspaceDocumentWithEncoding(context, encoding, discardDraft),
    saveWithEncoding: (encoding: WorkspaceTextEncoding) =>
      saveWorkspaceDocumentWithEncoding(context, encoding),
    lineEnding: state.lineEnding,
    normalizationRequired: state.normalizationRequired,
    normalizeLineEndings: (lineEnding: 'lf' | 'crlf') =>
      normalizeWorkspaceLineEndings(context, lineEnding),
    restoreDraftOverDisk: () => restoreWorkspaceDraftOverDisk(context),
    saveSnapshot: () => saveWorkspaceDocumentSnapshot(context, state.encoding),
    status: state.status,
  }
}
