import type { PreparedAttachment } from '@shared/types/agent'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from './composer-store'

function makeAttachment(id: string): PreparedAttachment {
  return {
    id,
    kind: 'text',
    name: `${id}.txt`,
    path: `/tmp/${id}.txt`,
    mimeType: 'text/plain',
    sizeBytes: 100,
    extractedText: 'content',
  }
}

describe('composer-store', () => {
  beforeEach(() => {
    useComposerStore.getState().reset()
    // Also ensure fields not cleared by reset are back to defaults
    useComposerStore.setState({
      actionDialog: null,
      actionDialogInput: '',
      actionDialogError: null,
      actionDialogBusy: false,
      isListening: false,
      isTranscribingVoice: false,
      voiceError: null,
      voiceElapsedSeconds: 0,
      voiceWaveform: [],
    })
  })

  describe('text input', () => {
    it('setInput updates the input field', () => {
      useComposerStore.getState().setInput('hello world')
      expect(useComposerStore.getState().input).toBe('hello world')
    })

    it('setCursorIndex updates the cursor position', () => {
      useComposerStore.getState().setCursorIndex(5)
      expect(useComposerStore.getState().cursorIndex).toBe(5)
    })
  })

  describe('attachments', () => {
    it('addAttachments appends to the attachment list', () => {
      const a1 = makeAttachment('a1')
      const a2 = makeAttachment('a2')
      useComposerStore.getState().addAttachments([a1])
      useComposerStore.getState().addAttachments([a2])
      expect(useComposerStore.getState().attachments).toHaveLength(2)
    })

    it('removeAttachment removes by id', () => {
      const a1 = makeAttachment('a1')
      const a2 = makeAttachment('a2')
      useComposerStore.getState().addAttachments([a1, a2])
      useComposerStore.getState().removeAttachment('a1')
      const remaining = useComposerStore.getState().attachments
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('a2')
    })

    it('setAttachmentError sets and clears errors', () => {
      useComposerStore.getState().setAttachmentError('too large')
      expect(useComposerStore.getState().attachmentError).toBe('too large')

      useComposerStore.getState().setAttachmentError(null)
      expect(useComposerStore.getState().attachmentError).toBeNull()
    })
  })

  describe('menu toggles', () => {
    it('openMenu sets only the targeted menu to true', () => {
      useComposerStore.getState().openMenu('quality')
      expect(useComposerStore.getState().qualityMenuOpen).toBe(true)
      expect(useComposerStore.getState().executionMenuOpen).toBe(false)
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
    })

    it('openMenu with null closes all menus', () => {
      useComposerStore.getState().openMenu('execution')
      useComposerStore.getState().openMenu(null)
      expect(useComposerStore.getState().qualityMenuOpen).toBe(false)
      expect(useComposerStore.getState().executionMenuOpen).toBe(false)
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
    })

    it('switching menus closes the previously open one', () => {
      useComposerStore.getState().openMenu('branch')
      expect(useComposerStore.getState().branchMenuOpen).toBe(true)

      useComposerStore.getState().openMenu('quality')
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
      expect(useComposerStore.getState().qualityMenuOpen).toBe(true)
    })
  })

  describe('action dialog', () => {
    it('openActionDialog sets kind and closes menus', () => {
      useComposerStore.getState().openMenu('quality')
      useComposerStore.getState().openActionDialog('create-branch', 'feat/new')
      expect(useComposerStore.getState().actionDialog).toBe('create-branch')
      expect(useComposerStore.getState().actionDialogInput).toBe('feat/new')
      expect(useComposerStore.getState().qualityMenuOpen).toBe(false)
    })

    it('closeActionDialog resets dialog state when not busy', () => {
      useComposerStore.getState().openActionDialog('delete-branch')
      useComposerStore.getState().closeActionDialog()
      expect(useComposerStore.getState().actionDialog).toBeNull()
    })

    it('closeActionDialog does nothing when busy', () => {
      useComposerStore.getState().openActionDialog('rename-branch')
      useComposerStore.getState().setActionDialogBusy(true)
      useComposerStore.getState().closeActionDialog()
      expect(useComposerStore.getState().actionDialog).toBe('rename-branch')
    })
  })

  describe('voice state', () => {
    it('setVoiceState applies partial patches', () => {
      useComposerStore.getState().setVoiceState({ isListening: true, voiceElapsedSeconds: 3 })
      expect(useComposerStore.getState().isListening).toBe(true)
      expect(useComposerStore.getState().voiceElapsedSeconds).toBe(3)
      expect(useComposerStore.getState().isTranscribingVoice).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears input, attachments, and menus', () => {
      useComposerStore.getState().setInput('draft')
      useComposerStore.getState().addAttachments([makeAttachment('a1')])
      useComposerStore.getState().openMenu('branch')
      useComposerStore.getState().setBranchMessage('done')

      useComposerStore.getState().reset()
      expect(useComposerStore.getState().input).toBe('')
      expect(useComposerStore.getState().attachments).toEqual([])
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
      expect(useComposerStore.getState().branchMessage).toBeNull()
    })
  })
})
