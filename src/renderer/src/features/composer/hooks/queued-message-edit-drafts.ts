import type { PreparedAttachment } from '@shared/types/agent'
import { WagglePresetId } from '@shared/types/brand'
import type { SessionFollowUpAttachmentDescriptor } from '@shared/types/session-control-queue'
import type { WaggleInvocation, WagglePreset } from '@shared/types/waggle'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { setEditorDraft } from '../lib/lexical-utils'
import { retainHostReferencedAttachments } from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'
import type { ComposerScopedDraft } from '../state/composer-store-types'
import { queuedMessageEditStashKey } from '../state/queued-message-edit-store'

const EMPTY_DRAFT: ComposerScopedDraft = { input: '', attachments: [], wagglePreset: null }

/** A queued attachment as a composer chip. It already exists on the Host, so only its id travels. */
function hostAttachment(descriptor: SessionFollowUpAttachmentDescriptor): PreparedAttachment {
  return {
    id: descriptor.id,
    kind: descriptor.kind,
    ...(descriptor.origin ? { origin: descriptor.origin } : {}),
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    path: '',
    extractedText: '',
  }
}

/** The queued Waggle invocation as the composer's Waggle chip. */
function wagglePresetFromInvocation(waggle: WaggleInvocation): WagglePreset {
  return {
    id: WagglePresetId(waggle.presetId),
    name: waggle.presetName,
    description: '',
    config: waggle.config,
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** The composer draft that edits `item`. */
export function queuedMessageDraft(item: SessionFollowUpQueueItem): ComposerScopedDraft {
  const attachments = item.attachments.map(hostAttachment)
  retainHostReferencedAttachments(attachments)
  return {
    input: item.text,
    attachments,
    wagglePreset: item.waggle ? wagglePresetFromInvocation(item.waggle) : null,
  }
}

/**
 * The Waggle invocation a save carries: the queued one while its chip is still in place (so its
 * source and config are unchanged), the chosen preset when the user picked another, none when
 * the chip was removed.
 */
export function editedWaggle(
  preset: WagglePreset | null,
  queued: WaggleInvocation | undefined,
): WaggleInvocation | undefined {
  if (!preset) return undefined
  if (queued && queued.presetId === String(preset.id)) return queued
  return { presetId: preset.id, presetName: preset.name, source: 'user', config: preset.config }
}

/** Reads a draft, committing Lexical's batched edits first when it is the visible one. */
export function readComposerDraft(contextKey: string): ComposerScopedDraft {
  const visible = useComposerStore.getState()
  if (visible.activeDraftContextKey !== contextKey) {
    return visible.scopedDrafts[contextKey] ?? EMPTY_DRAFT
  }
  visible.lexicalEditor?.read(() => undefined)
  const state = useComposerStore.getState()
  return {
    input: state.input,
    attachments: state.attachments,
    wagglePreset: state.selectedWagglePreset,
  }
}

/** Replaces a draft: in the editor when it is visible, in the scoped drafts otherwise. */
export function writeComposerDraft(contextKey: string, draft: ComposerScopedDraft) {
  const state = useComposerStore.getState()
  if (state.activeDraftContextKey !== contextKey) {
    state.saveScopedDraft(contextKey, draft)
    return
  }
  const preset = draft.wagglePreset ?? null
  state.setInput(draft.input)
  state.replaceAttachments(draft.attachments)
  state.setSelectedWagglePreset(preset)
  state.setAttachmentError(null)
  if (state.lexicalEditor) setEditorDraft(state.lexicalEditor, draft.input, preset)
}

/**
 * Sets the Session's draft aside and puts the queued message in its place. The draft is stashed
 * before it leaves the composer so its attachments are never unowned in between.
 */
export function stashDraftAndLoad(
  sessionId: string,
  contextKey: string,
  edit: ComposerScopedDraft,
) {
  const stashKey = queuedMessageEditStashKey(sessionId)
  useComposerStore.getState().saveScopedDraft(stashKey, readComposerDraft(contextKey))
  writeComposerDraft(contextKey, edit)
}

/** Takes the set-aside draft back out of the stash. */
export function takeStashedDraft(sessionId: string): ComposerScopedDraft {
  const stashKey = queuedMessageEditStashKey(sessionId)
  const store = useComposerStore.getState()
  const stashed = store.getScopedDraft(stashKey) ?? EMPTY_DRAFT
  return {
    ...stashed,
    // Leave the stash only after the draft is back, so its attachments stay owned throughout.
    attachments: [...stashed.attachments],
  }
}

export function clearStashedDraft(sessionId: string) {
  useComposerStore.getState().clearScopedDraft(queuedMessageEditStashKey(sessionId))
}
