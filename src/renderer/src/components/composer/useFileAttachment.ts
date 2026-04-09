import type { PreparedAttachment } from '@shared/types/agent'
import { useRef, useState } from 'react'
import { api } from '@/lib/ipc'

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

function extractFilePaths(files: readonly File[]): string[] {
  return files.map((file) => api.getFilePath(file)).filter((filePath) => filePath.length > 0)
}

async function prepareAndAttach(
  projectPath: string,
  paths: string[],
  addAttachments: (attachments: PreparedAttachment[]) => void,
  setAttachmentError: (error: string | null) => void,
  onToast: ((message: string) => void) | undefined,
): Promise<void> {
  try {
    setAttachmentError(null)
    const prepared = await api.prepareAttachments(projectPath, paths)
    addAttachments(prepared)
    onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to prepare attachments.'
    setAttachmentError(message)
    onToast?.(message)
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

  function handleDragEnter(event: React.DragEvent): void {
    event.preventDefault()
    dragCounterRef.current++
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(event: React.DragEvent): void {
    event.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(event: React.DragEvent): void {
    event.preventDefault()
    if (isAtCapacity) {
      event.dataTransfer.dropEffect = 'none'
    }
  }

  async function validateAndAttach(paths: string[]): Promise<void> {
    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (paths.length === 0) return
    if (isAtCapacity) return

    // Silently trim to remaining capacity
    const trimmed = paths.slice(0, remainingSlots)
    await prepareAndAttach(projectPath, trimmed, addAttachments, setAttachmentError, onToast)
  }

  async function handleDrop(event: React.DragEvent): Promise<void> {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)

    if (isAtCapacity) return

    const paths = extractFilePaths(Array.from(event.dataTransfer.files))
    await validateAndAttach(paths)
  }

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const paths = extractFilePaths(Array.from(event.target.files ?? []))
    event.target.value = ''
    await validateAndAttach(paths)
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
