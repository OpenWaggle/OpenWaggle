import { PERCENT_BASE } from '@shared/constants/math'
import type { PreparedAttachment } from '@shared/types/agent'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'

const LONG_PROMPT_THRESHOLD = 12_000
const MAX_ATTACHMENTS = 5
const PENDING_ATTACHMENT_DISMISS_DELAY_MS = 1200
const AUTO_PASTE_ATTACHMENT_NAME_PREFIX = 'Pasted Text '
const AUTO_PASTE_ATTACHMENT_FILE_EXTENSION = '.md'

export interface PendingTextAttachmentChip {
  operationId: string
  name: string
  progressPercent: number
  status: 'preparing' | 'ready'
  attachmentId: string | null
}

interface UseAutoTextAttachmentOptions {
  attachments: PreparedAttachment[]
  addAttachments: (attachments: PreparedAttachment[]) => void
  removeAttachment: (attachmentId: string) => void
  setAttachmentError: (error: string | null) => void
  setInput: (input: string) => void
  onToast?: (message: string) => void
}

interface UseAutoTextAttachmentResult {
  pendingTextAttachmentChips: PendingTextAttachmentChip[]
  hasPreparingTextAttachment: boolean
  preparingPendingCount: number
  /** Called by PastePlugin. Returns true if the paste was auto-converted to an attachment. */
  checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
  removePendingTextAttachment: (operationId: string, attachmentId: string) => void
}

export function useAutoTextAttachment({
  attachments,
  addAttachments,
  removeAttachment,
  setAttachmentError,
  setInput,
  onToast,
}: UseAutoTextAttachmentOptions): UseAutoTextAttachmentResult {
  const nextAutoPasteAttachmentIndexRef = useRef(1)
  const pendingAttachmentTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [pendingTextAttachmentChips, setPendingTextAttachmentChips] = useState<
    PendingTextAttachmentChip[]
  >([])

  const preparingPendingCount = pendingTextAttachmentChips.filter(
    (chip) => chip.status === 'preparing',
  ).length
  const hasPreparingTextAttachment = preparingPendingCount > 0

  function clearPendingChip(operationId: string): void {
    const timer = pendingAttachmentTimersRef.current.get(operationId)
    if (timer) {
      clearTimeout(timer)
      pendingAttachmentTimersRef.current.delete(operationId)
    }
    setPendingTextAttachmentChips((chips) =>
      chips.filter((chip) => chip.operationId !== operationId),
    )
  }

  async function handleAutoConvertLongPaste(
    pastedText: string,
    fallbackInput: string,
    operationId: string,
    chipName: string,
  ): Promise<void> {
    const trimmedPastedText = pastedText.trim()
    if (!trimmedPastedText) return

    const prepareAttachmentFromText = api.prepareAttachmentFromText
    if (typeof prepareAttachmentFromText !== 'function') {
      clearPendingChip(operationId)
      setAttachmentError('Attachment conversion is unavailable. Please restart the app.')
      setInput(fallbackInput)
      return
    }

    const autoAttachment = await prepareAttachmentFromText(trimmedPastedText, operationId).catch(
      () => null,
    )
    if (!autoAttachment) {
      clearPendingChip(operationId)
      setInput(fallbackInput)
      return
    }

    setAttachmentError(null)
    addAttachments([{ ...autoAttachment, name: chipName }])
    setPendingTextAttachmentChips((chips) =>
      chips.map((chip) =>
        chip.operationId === operationId
          ? {
              ...chip,
              status: 'ready',
              progressPercent: PERCENT_BASE,
              attachmentId: autoAttachment.id,
            }
          : chip,
      ),
    )

    const dismissTimer = setTimeout(() => {
      setPendingTextAttachmentChips((chips) =>
        chips.filter((chip) => chip.operationId !== operationId),
      )
      pendingAttachmentTimersRef.current.delete(operationId)
    }, PENDING_ATTACHMENT_DISMISS_DELAY_MS)
    pendingAttachmentTimersRef.current.set(operationId, dismissTimer)
    onToast?.('Long prompt auto-converted to file attachment.')
  }

  function checkAndConvertPaste(pastedText: string, currentEditorText: string): boolean {
    if (!pastedText) return false

    const nextValue = `${currentEditorText}${pastedText}`
    const usedAttachmentSlots = attachments.length + preparingPendingCount
    const shouldAutoConvert =
      nextValue.trim().length > LONG_PROMPT_THRESHOLD && usedAttachmentSlots < MAX_ATTACHMENTS
    if (!shouldAutoConvert) return false

    const operationId = globalThis.crypto.randomUUID()
    const chipName = `${AUTO_PASTE_ATTACHMENT_NAME_PREFIX}${String(nextAutoPasteAttachmentIndexRef.current)}${AUTO_PASTE_ATTACHMENT_FILE_EXTENSION}`
    nextAutoPasteAttachmentIndexRef.current += 1

    setPendingTextAttachmentChips((chips) => [
      ...chips,
      {
        operationId,
        name: chipName,
        progressPercent: 0,
        status: 'preparing',
        attachmentId: null,
      },
    ])

    void handleAutoConvertLongPaste(pastedText, currentEditorText, operationId, chipName)
    return true
  }

  function removePendingTextAttachment(operationId: string, attachmentId: string): void {
    removeAttachment(attachmentId)
    setPendingTextAttachmentChips((chips) =>
      chips.filter((entry) => entry.operationId !== operationId),
    )
  }

  useEffect(() => {
    const subscribeToProgress = api.onPrepareAttachmentFromTextProgress
    if (typeof subscribeToProgress !== 'function') {
      return () => {}
    }

    const unsubscribe = subscribeToProgress((payload) => {
      setPendingTextAttachmentChips((chips) =>
        chips.map((chip) =>
          chip.operationId === payload.operationId
            ? {
                ...chip,
                progressPercent: payload.progressPercent,
                status: payload.stage === 'completed' ? 'ready' : chip.status,
              }
            : chip,
        ),
      )
    })

    return () => {
      unsubscribe()
      for (const timer of pendingAttachmentTimersRef.current.values()) {
        clearTimeout(timer)
      }
      pendingAttachmentTimersRef.current.clear()
    }
  }, [])

  return {
    pendingTextAttachmentChips,
    hasPreparingTextAttachment,
    preparingPendingCount,
    checkAndConvertPaste,
    removePendingTextAttachment,
  }
}
