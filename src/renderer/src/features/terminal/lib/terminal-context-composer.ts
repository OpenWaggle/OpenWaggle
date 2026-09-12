import { ATTACHMENT } from '@shared/constants/resource-limits'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import {
  buildTerminalContextPayload,
  type TerminalContextPayload,
  type TerminalContextSelection,
} from './terminal-context'

const TERMINAL_ATTACHMENT_LABEL_MAX_LENGTH = 80

function attachmentName(payload: TerminalContextPayload) {
  const entry = payload.entries[0]
  const label = (entry?.terminalLabel ?? 'selection')
    .replace(/[^\p{L}\p{N}_. -]+/gu, '-')
    .trim()
    .slice(0, TERMINAL_ATTACHMENT_LABEL_MAX_LENGTH)
  const range = entry?.range
  const lines =
    range === null || range === undefined
      ? ''
      : range.startLine === range.endLine
        ? ` line ${String(range.startLine)}`
        : ` lines ${String(range.startLine)}-${String(range.endLine)}`
  return `Terminal · ${label || 'selection'}${lines}.md`
}

/** Adds bounded, explicitly untrusted terminal data as a removable composer context chip. */
export async function appendTerminalContextToComposer(
  selection: TerminalContextSelection,
): Promise<TerminalContextPayload | null> {
  const payload = buildTerminalContextPayload([selection])
  if (payload === null) return null
  const composer = useComposerStore.getState()
  if (composer.attachments.length >= ATTACHMENT.MAX_COUNT) {
    throw new Error(
      `Remove an attachment before adding terminal context (maximum ${String(ATTACHMENT.MAX_COUNT)}).`,
    )
  }
  const draftContextKey = composer.activeDraftContextKey
  const prepared = await api.prepareAttachmentFromText(payload.xml, crypto.randomUUID())
  const currentComposer = useComposerStore.getState()
  if (currentComposer.activeDraftContextKey !== draftContextKey) {
    throw new Error('The active draft changed before terminal context was attached.')
  }
  currentComposer.addAttachments([{ ...prepared, name: attachmentName(payload) }])
  return payload
}
