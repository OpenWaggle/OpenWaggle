import type { PreparedAttachment } from '@shared/types/agent'
import { useRef, useState } from 'react'
import { withFinally } from '@/shared/lib/async-outcome'
import { registerAttachmentPreviewUrls } from '@/shared/lib/attachment-preview-urls'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { trackAttachmentPreparation } from '../state/composer-activity-store'
import { useComposerInputGuard } from './useComposerInputGuard'

const logger = createRendererLogger('file-attachment')

const MAX_ATTACHMENTS = 5

interface UseFileAttachmentParams {
  readonly disabled?: boolean
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
  /**
   * Takes a paste that carries files or a clipboard image, and answers whether it did. `false`
   * leaves the paste to the editor's text handling (ADR 0068).
   */
  readonly handlePaste: (event: ClipboardEvent) => boolean
  readonly handleAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

/** The name a pasted clipboard image is attached under; it carries no name of its own. */
const PASTED_IMAGE_NAME = 'pasted-image.png'

/** The files a paste carries; a clipboard bitmap may arrive only as an item, never as a file. */
function pastedFiles(event: ClipboardEvent) {
  const clipboardData = event.clipboardData
  if (!clipboardData) return []
  const files = Array.from(clipboardData.files)
  if (files.length > 0) return files
  return Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
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
  isCurrentDraft: () => boolean,
) {
  try {
    setAttachmentError(null)
    const prepared = await trackAttachmentPreparation(api.prepareAttachments(projectPath, files))
    if (!isCurrentDraft()) return
    if (prepared.length === 0) return
    registerAttachmentPreviewUrls(prepared, files)
    addAttachments(prepared.map(({ attachment }) => attachment))
    onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`)
  } catch (err) {
    if (!isCurrentDraft()) return
    reportAttachmentError(err, setAttachmentError, onToast)
  }
}

export function useFileAttachment({
  disabled = false,
  projectPath,
  attachments,
  preparingPendingCount,
  addAttachments,
  setAttachmentError,
  onToast,
}: UseFileAttachmentParams) {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const captureInputGuard = useComposerInputGuard(disabled)

  const usedSlots = attachments.length + preparingPendingCount
  const remainingSlots = Math.max(0, MAX_ATTACHMENTS - usedSlots)
  const isAtCapacity = remainingSlots === 0

  function handleDragEnter(event: React.DragEvent) {
    event.preventDefault()
    if (disabled) return
    dragCounterRef.current++
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
    if (disabled || isAtCapacity) {
      event.dataTransfer.dropEffect = 'none'
    }
  }

  async function validateAndAttach(files: readonly File[]) {
    if (disabled) return
    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (files.length === 0) return
    if (isAtCapacity) return

    // Silently trim to remaining capacity
    const trimmed = files.slice(0, remainingSlots)
    await prepareAndAttach(
      projectPath,
      trimmed,
      addAttachments,
      setAttachmentError,
      onToast,
      captureInputGuard(),
    )
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

  /**
   * A clipboard image has no file and no name, so the desktop shell reads the system clipboard and
   * its bytes become the attachment (ADR 0068).
   */
  async function attachClipboardImage() {
    if (disabled || isAtCapacity) return
    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    const isCurrentDraft = captureInputGuard()
    try {
      setAttachmentError(null)
      const image = await api.readClipboardImage()
      if (!image) return
      const attachment = await api.prepareImageAttachment(
        image.bytes,
        PASTED_IMAGE_NAME,
        image.mimeType,
      )
      if (!isCurrentDraft()) return
      addAttachments([attachment])
      onToast?.('Attached 1 file.')
    } catch (err) {
      if (!isCurrentDraft()) return
      reportAttachmentError(err, setAttachmentError, onToast)
    }
  }

  /**
   * Files on the clipboard win, then an image with no accompanying text. Text pasted alongside an
   * image is what the person meant, so that paste stays with the editor (ADR 0068).
   */
  function handlePaste(event: ClipboardEvent) {
    if (disabled) return false
    const files = pastedFiles(event)
    if (files.length > 0) {
      void validateAndAttach(files)
      return true
    }
    if ((event.clipboardData?.getData('text/plain') ?? '').trim().length > 0) return false
    void attachClipboardImage()
    return true
  }

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    await withFinally(
      () =>
        validateAndAttach(files).catch((err: unknown) => {
          reportAttachmentError(err, setAttachmentError, onToast)
        }),
      () => {
        event.target.value = ''
      },
    )
  }

  return {
    isDragOver,
    isAtCapacity,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    handleAttachFiles,
  }
}
