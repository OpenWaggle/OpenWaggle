import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

const AUTOSAVE_DELAY_MS = 500
const TAB = '  '
const WRAP_STORAGE_KEY = 'openwaggle:file-editor-word-wrap'
const EDITOR_LINE_HEIGHT_PX = 20
const TARGET_LINE_CONTEXT = 3

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

interface RecoveredWorkspaceDraft {
  readonly content: string
  readonly message: string
  readonly status: Extract<SaveStatus, 'conflict' | 'error'>
}

const recoveredWorkspaceDrafts = new Map<string, RecoveredWorkspaceDraft>()

function workspaceDraftKey(projectPath: string, path: string) {
  return `${projectPath}\u0000${path}`
}

function lineRange(content: string, line: number) {
  const lines = content.split('\n')
  const boundedLine = Math.min(Math.max(1, line), lines.length)
  let start = 0
  for (let index = 0; index < boundedLine - 1; index += 1) {
    start += (lines[index]?.length ?? 0) + 1
  }
  return { start, end: start + (lines[boundedLine - 1]?.length ?? 0) }
}

function useFileSaveQueue(projectPath: string, file: WorkspaceTextFileReadResult) {
  const queryClient = useQueryClient()
  const recoveryKey = workspaceDraftKey(projectPath, file.path)
  const recoveredDraft = recoveredWorkspaceDrafts.get(recoveryKey)
  const [content, setContent] = useState(recoveredDraft?.content ?? file.content)
  const [savedContent, setSavedContent] = useState(file.content)
  const [status, setStatus] = useState<SaveStatus>(recoveredDraft?.status ?? 'saved')
  const [errorMessage, setErrorMessage] = useState<string | null>(recoveredDraft?.message ?? null)
  const revisionRef = useRef(file.revision)
  const latestContentRef = useRef(recoveredDraft?.content ?? file.content)
  const savedContentRef = useRef(file.content)
  const savingRef = useRef(false)
  const pendingRef = useRef<string | null>(null)
  const conflictRef = useRef(recoveredDraft?.status === 'conflict')
  const mountedRef = useRef(true)

  function preserveFailedDraft(input: {
    readonly message: string
    readonly status: Extract<SaveStatus, 'conflict' | 'error'>
  }) {
    const freshestContent = latestContentRef.current
    conflictRef.current = input.status === 'conflict'
    pendingRef.current = null
    recoveredWorkspaceDrafts.set(recoveryKey, {
      content: freshestContent,
      message: input.message,
      status: input.status,
    })
    if (mountedRef.current) {
      setErrorMessage(input.message)
      setStatus(input.status)
    } else {
      useUIStore.getState().showToast(`Could not save ${file.basename}: ${input.message}`, 'error')
    }
  }

  async function saveSnapshot(snapshot: string) {
    if (conflictRef.current) return
    if (savingRef.current) {
      pendingRef.current = snapshot
      return
    }
    savingRef.current = true
    let nextSnapshot: string | null = snapshot
    while (nextSnapshot !== null) {
      const savingSnapshot = nextSnapshot
      pendingRef.current = null
      if (mountedRef.current) {
        setStatus('saving')
        setErrorMessage(null)
      }
      try {
        const result = await api.writeWorkspaceFile({
          projectPath,
          path: file.path,
          content: savingSnapshot,
          expectedRevision: revisionRef.current,
        })
        const saved = matchBy(result, 'status')
          .with('saved', (savedResult) => {
            revisionRef.current = savedResult.revision
            savedContentRef.current = savingSnapshot
            recoveredWorkspaceDrafts.delete(recoveryKey)
            if (mountedRef.current) setSavedContent(savingSnapshot)
            queryClient.setQueryData(queryKeys.workspaceFile(projectPath, file.path), {
              ...file,
              content: savingSnapshot,
              size: savedResult.size,
              modifiedAt: savedResult.modifiedAt,
              revision: savedResult.revision,
            })
            if (mountedRef.current) {
              setStatus(latestContentRef.current === savingSnapshot ? 'saved' : 'dirty')
            }
            return true
          })
          .with('conflict', (conflictResult) => {
            preserveFailedDraft({ message: conflictResult.message, status: 'conflict' })
            return false
          })
          .with('too-large', (tooLargeResult) => {
            preserveFailedDraft({ message: tooLargeResult.message, status: 'error' })
            return false
          })
          .exhaustive()
        if (!saved) break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        preserveFailedDraft({ message, status: 'error' })
        break
      }
      nextSnapshot = pendingRef.current
    }
    savingRef.current = false
  }

  const saveSnapshotFromEffect = useEffectEvent(saveSnapshot)

  useEffect(() => {
    if (content === savedContent || conflictRef.current) return
    const timer = window.setTimeout(() => void saveSnapshotFromEffect(content), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [content, savedContent])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (!conflictRef.current && latestContentRef.current !== savedContentRef.current) {
        if (savingRef.current) pendingRef.current = latestContentRef.current
        else void saveSnapshotFromEffect(latestContentRef.current)
      }
    }
  }, [])

  function setDraftContent(value: string) {
    latestContentRef.current = value
    setContent(value)
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setDraftContent(value)
    if (!conflictRef.current) setStatus(value === savedContentRef.current ? 'saved' : 'dirty')
  }

  async function reloadFromDisk() {
    const next = await api.readWorkspaceFile(projectPath, file.path)
    if (!['text', 'markdown', 'html'].includes(next.previewKind)) return
    if (!('content' in next)) return
    conflictRef.current = false
    pendingRef.current = null
    revisionRef.current = next.revision
    latestContentRef.current = next.content
    savedContentRef.current = next.content
    setContent(next.content)
    setSavedContent(next.content)
    setStatus('saved')
    setErrorMessage(null)
    recoveredWorkspaceDrafts.delete(recoveryKey)
    queryClient.setQueryData(queryKeys.workspaceFile(projectPath, file.path), next)
  }

  return {
    content,
    errorMessage,
    handleChange,
    reloadFromDisk,
    saveSnapshot,
    setContent: setDraftContent,
    setStatus,
    status,
  }
}

export function useWorkspaceFileEditing({
  projectPath,
  file,
  targetLine,
}: {
  readonly projectPath: string
  readonly file: WorkspaceTextFileReadResult
  readonly targetLine: number | null
}) {
  const queue = useFileSaveQueue(projectPath, file)
  const [preview, setPreview] = useState(file.previewKind === 'markdown' && targetLine === null)
  const [wordWrap, setWordWrap] = useState(
    () => window.localStorage.getItem(WRAP_STORAGE_KEY) !== 'false',
  )
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)

  const focusTargetLine = useEffectEvent((line: number) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const range = lineRange(queue.content, line)
    textarea.focus()
    textarea.setSelectionRange(range.start, range.end)
    textarea.scrollTop = Math.max(0, (line - TARGET_LINE_CONTEXT) * EDITOR_LINE_HEIGHT_PX)
  })

  useEffect(() => {
    if (!targetLine || preview) return
    focusTargetLine(targetLine)
  }, [preview, targetLine])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void queue.saveSnapshot(queue.content)
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    const textarea = event.currentTarget
    const next = `${queue.content.slice(0, textarea.selectionStart)}${TAB}${queue.content.slice(
      textarea.selectionEnd,
    )}`
    const selection = textarea.selectionStart + TAB.length
    queue.setContent(next)
    queue.setStatus('dirty')
    window.requestAnimationFrame(() => textarea.setSelectionRange(selection, selection))
  }

  function syncGutter(event: UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
  }

  function toggleWordWrap() {
    const next = !wordWrap
    setWordWrap(next)
    window.localStorage.setItem(WRAP_STORAGE_KEY, String(next))
  }

  return {
    ...queue,
    canPreview: file.previewKind === 'markdown' || file.previewKind === 'html',
    gutterRef,
    handleKeyDown,
    preview,
    setPreview,
    syncGutter,
    textareaRef,
    toggleWordWrap,
    wordWrap,
  }
}
