import { ATTACHMENT } from '@shared/constants/resource-limits'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import {
  buildTerminalContextPayload,
  type TerminalContextPayload,
  type TerminalContextSelection,
} from './terminal-context'

const TERMINAL_ATTACHMENT_LABEL_MAX_LENGTH = 80
/** Keeps the whole name, which is also its prompt file's name, within a 255-byte file name. */
const TERMINAL_ATTACHMENT_LABEL_MAX_BYTES = 160
const utf8 = new TextEncoder()

/** The label's leading characters, whole code points, within both bounds. */
function boundedLabel(label: string) {
  let bounded = ''
  let bytes = 0
  for (const character of Array.from(label).slice(0, TERMINAL_ATTACHMENT_LABEL_MAX_LENGTH)) {
    bytes += utf8.encode(character).byteLength
    if (bytes > TERMINAL_ATTACHMENT_LABEL_MAX_BYTES) break
    bounded += character
  }
  return bounded
}

function attachmentName(payload: TerminalContextPayload) {
  const entry = payload.entries[0]
  const label = boundedLabel(
    (entry?.terminalLabel ?? 'selection').replace(/[^\p{L}\p{N}_. -]+/gu, '-').trim(),
  )
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
  const prepared = await api.prepareAttachmentFromText(
    payload.xml,
    crypto.randomUUID(),
    attachmentName(payload),
  )
  const currentComposer = useComposerStore.getState()
  if (currentComposer.activeDraftContextKey !== draftContextKey) {
    throw new Error('The active draft changed before terminal context was attached.')
  }
  currentComposer.addAttachments([prepared])
  return payload
}
