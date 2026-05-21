import type { PreparedAttachment } from '@shared/types/agent'
import { useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('file-attachment')

const MAX_ATTACHMENTS = 5

interface UseFileAttachmentParams {
  readonly projectPath: string | null
  readonly attachments: readonly PreparedAttachment[]
  readonly preparingPendingCount: number
  readonly addAttachments: (attachments: PreparedAttachment[]) => void
  readonly setAttachmentError: (error: string | null) => void
  readonly onToast?: (message: string) => void
}

export interface UseFileAttachmentResult {
  readonly isDragOver: boolean
  readonly isAtCapacity: boolean
  readonly handleDragEnter: (event: React.DragEvent) => void
  readonly handleDragLeave: (event: React.DragEvent) => void
  readonly handleDragOver: (event: React.DragEvent) => void
  readonly handleDrop: (event: React.DragEvent) => Promise<void>
  readonly handleAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

function describeAttachmentError(err: unknown) {
  return err instanceof Error ? err.message : 'Failed to prepare attachments.'
}

function reportAttachmentError(
  err: unknown,
  setAttachmentError: (error: string | null) => void,
  onToast: ((message: string) => void) | undefined,
) {
  const message = describeAttachmentError(err)
  logger.warn('Failed to prepare selected file attachments', { error: message })
  setAttachmentError(message)
  onToast?.(message)
}

async function prepareAndAttach(
  projectPath: string,
  files: readonly File[],
  addAttachments: (attachments: PreparedAttachment[]) => void,
  setAttachmentError: (error: string | null) => void,
  onToast: ((message: string) => void) | undefined,
) {
  try {
    setAttachmentError(null)
    const prepared = await api.prepareAttachments(projectPath, files)
    if (prepared.length === 0) return
    addAttachments(prepared)
    onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`)
  } catch (err) {
    reportAttachmentError(err, setAttachmentError, onToast)
  }
}

export function useFileAttachment({
  projectPath,
  attachments,
  preparingPendingCount,
  addAttachments,
  setAttachmentError,
  onToast,
}: UseFileAttachmentParams): UseFileAttachmentResult {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const usedSlots = attachments.length + preparingPendingCount
  const remainingSlots = Math.max(0, MAX_ATTACHMENTS - usedSlots)
  const isAtCapacity = remainingSlots === 0

  function handleDragEnter(event: React.DragEvent) {
    event.preventDefault()
    dragCounterRef.current++
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
    if (isAtCapacity) {
      event.dataTransfer.dropEffect = 'none'
    }
  }

  async function validateAndAttach(files: readonly File[]) {
    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (files.length === 0) return
    if (isAtCapacity) return

    // Silently trim to remaining capacity
    const trimmed = files.slice(0, remainingSlots)
    await prepareAndAttach(projectPath, trimmed, addAttachments, setAttachmentError, onToast)
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)

    if (isAtCapacity) return

    try {
      await validateAndAttach(Array.from(event.dataTransfer.files))
    } catch (err) {
      reportAttachmentError(err, setAttachmentError, onToast)
    }
  }

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    try {
      await validateAndAttach(files)
    } catch (err) {
      reportAttachmentError(err, setAttachmentError, onToast)
    } finally {
      event.target.value = ''
    }
  }

  return {
    isDragOver,
    isAtCapacity,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleAttachFiles,
  }
}
