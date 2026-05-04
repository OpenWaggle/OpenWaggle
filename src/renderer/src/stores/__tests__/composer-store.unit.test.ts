import type { PreparedAttachment } from '@shared/types/agent'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '../composer-store'

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
      activeDraftContextKey: null,
      scopedDrafts: {},
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
      useComposerStore.getState().openMenu('thinking')
      expect(useComposerStore.getState().thinkingMenuOpen).toBe(true)
      expect(useComposerStore.getState().executionMenuOpen).toBe(false)
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
    })

    it('openMenu with null closes all menus', () => {
      useComposerStore.getState().openMenu('execution')
      useComposerStore.getState().openMenu(null)
      expect(useComposerStore.getState().thinkingMenuOpen).toBe(false)
      expect(useComposerStore.getState().executionMenuOpen).toBe(false)
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
    })

    it('switching menus closes the previously open one', () => {
      useComposerStore.getState().openMenu('branch')
      expect(useComposerStore.getState().branchMenuOpen).toBe(true)

      useComposerStore.getState().openMenu('thinking')
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
      expect(useComposerStore.getState().thinkingMenuOpen).toBe(true)
    })
  })

  describe('prompt history', () => {
    beforeEach(() => {
      useComposerStore.setState({ promptHistory: [], historyIndex: 0, draftInput: '' })
    })

    it('pushHistory adds entry to history', () => {
      useComposerStore.getState().pushHistory('first prompt')
      expect(useComposerStore.getState().promptHistory).toEqual(['first prompt'])
    })

    it('pushHistory deduplicates consecutive identical entries', () => {
      useComposerStore.getState().pushHistory('same')
      useComposerStore.getState().pushHistory('same')
      expect(useComposerStore.getState().promptHistory).toEqual(['same'])
    })

    it('pushHistory ignores blank text', () => {
      useComposerStore.getState().pushHistory('')
      useComposerStore.getState().pushHistory('   ')
      expect(useComposerStore.getState().promptHistory).toEqual([])
    })

    it('pushHistory caps at 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        useComposerStore.getState().pushHistory(`prompt ${String(i)}`)
      }
      expect(useComposerStore.getState().promptHistory).toHaveLength(100)
      expect(useComposerStore.getState().promptHistory[0]).toBe('prompt 10')
      expect(useComposerStore.getState().promptHistory[99]).toBe('prompt 109')
    })

    it('historyUp walks backward through entries', () => {
      useComposerStore.getState().pushHistory('a')
      useComposerStore.getState().pushHistory('b')
      useComposerStore.getState().pushHistory('c')

      expect(useComposerStore.getState().historyUp('')).toBe('c')
      expect(useComposerStore.getState().historyUp('')).toBe('b')
      expect(useComposerStore.getState().historyUp('')).toBe('a')
      expect(useComposerStore.getState().historyUp('')).toBeNull()
    })

    it('historyDown walks forward through entries', () => {
      useComposerStore.getState().pushHistory('a')
      useComposerStore.getState().pushHistory('b')

      // Walk up fully
      useComposerStore.getState().historyUp('')
      useComposerStore.getState().historyUp('')

      // Walk down
      expect(useComposerStore.getState().historyDown()).toBe('b')
      expect(useComposerStore.getState().historyDown()).toBe('')
      expect(useComposerStore.getState().historyDown()).toBeNull()
    })

    it('historyUp saves draft input and historyDown restores it', () => {
      useComposerStore.getState().pushHistory('older')
      const result = useComposerStore.getState().historyUp('my draft')
      expect(result).toBe('older')
      expect(useComposerStore.getState().draftInput).toBe('my draft')

      const restored = useComposerStore.getState().historyDown()
      expect(restored).toBe('my draft')
    })

    it('historyUp returns null when history is empty', () => {
      expect(useComposerStore.getState().historyUp('')).toBeNull()
    })

    it('historyDown returns null when already at draft position', () => {
      useComposerStore.getState().pushHistory('x')
      expect(useComposerStore.getState().historyDown()).toBeNull()
    })

    it('reset preserves history but resets navigation position', () => {
      useComposerStore.getState().pushHistory('kept')
      useComposerStore.getState().historyUp('')
      useComposerStore.getState().reset()

      expect(useComposerStore.getState().promptHistory).toEqual(['kept'])
      expect(useComposerStore.getState().historyIndex).toBe(1)
      expect(useComposerStore.getState().draftInput).toBe('')
    })
  })

  describe('scoped drafts', () => {
    it('saves the current context and loads the fallback draft when switching contexts', () => {
      const attachment = makeAttachment('a1')
      useComposerStore.getState().setInput('main draft')
      useComposerStore.getState().addAttachments([attachment])
      useComposerStore.getState().setActiveDraftContextKey('project:/tmp:session:s1:branch:main')

      const applied = useComposerStore
        .getState()
        .switchScopedDraftContext('project:/tmp:session:s1:draft:n1', {
          input: 'retry prompt',
          attachments: [],
        })

      expect(applied.input).toBe('retry prompt')
      expect(useComposerStore.getState().input).toBe('retry prompt')
      expect(
        useComposerStore.getState().getScopedDraft('project:/tmp:session:s1:branch:main'),
      ).toEqual({ input: 'main draft', attachments: [attachment] })
    })

    it('loads a saved draft instead of the fallback for an existing context', () => {
      useComposerStore.getState().saveScopedDraft('project:/tmp:session:s1:branch:main', {
        input: 'saved main draft',
        attachments: [],
      })

      const applied = useComposerStore
        .getState()
        .switchScopedDraftContext('project:/tmp:session:s1:branch:main', {
          input: 'fallback',
          attachments: [],
        })

      expect(applied.input).toBe('saved main draft')
      expect(useComposerStore.getState().input).toBe('saved main draft')
    })

    it('removes the active scoped draft on reset after send', () => {
      useComposerStore.getState().setInput('draft to send')
      useComposerStore.getState().setActiveDraftContextKey('project:/tmp:session:s1:branch:main')
      useComposerStore.getState().saveScopedDraft('project:/tmp:session:s1:branch:main', {
        input: 'draft to send',
        attachments: [],
      })

      useComposerStore.getState().reset()

      expect(
        useComposerStore.getState().getScopedDraft('project:/tmp:session:s1:branch:main'),
      ).toBeNull()
    })

    it('clears visible draft state when clearing drafts for the active session', () => {
      const attachment = makeAttachment('session-draft')
      useComposerStore.getState().setActiveDraftContextKey('project:/tmp:session:s1:branch:main')
      useComposerStore.getState().setInput('archived draft')
      useComposerStore.getState().addAttachments([attachment])
      useComposerStore.getState().saveScopedDraft('project:/tmp:session:s1:branch:main', {
        input: 'archived draft',
        attachments: [attachment],
      })

      useComposerStore.getState().clearScopedDraftsForSession('s1')

      expect(useComposerStore.getState().activeDraftContextKey).toBeNull()
      expect(useComposerStore.getState().input).toBe('')
      expect(useComposerStore.getState().attachments).toEqual([])
      expect(
        useComposerStore.getState().getScopedDraft('project:/tmp:session:s1:branch:main'),
      ).toBeNull()
    })

    it('clears visible draft state when clearing drafts for the active branch', () => {
      const attachment = makeAttachment('branch-draft')
      useComposerStore.getState().setActiveDraftContextKey('project:/tmp:session:s1:branch:b1')
      useComposerStore.getState().setInput('archived branch draft')
      useComposerStore.getState().addAttachments([attachment])
      useComposerStore.getState().saveScopedDraft('project:/tmp:session:s1:branch:b1', {
        input: 'archived branch draft',
        attachments: [attachment],
      })

      useComposerStore.getState().clearScopedDraftsForBranch('s1', 'b1')

      expect(useComposerStore.getState().activeDraftContextKey).toBeNull()
      expect(useComposerStore.getState().input).toBe('')
      expect(useComposerStore.getState().attachments).toEqual([])
      expect(
        useComposerStore.getState().getScopedDraft('project:/tmp:session:s1:branch:b1'),
      ).toBeNull()
    })
  })

  describe('reset', () => {
    it('clears input, attachments, and menus', () => {
      useComposerStore.getState().setInput('draft')
      useComposerStore.getState().addAttachments([makeAttachment('a1')])
      useComposerStore.getState().openMenu('branch')

      useComposerStore.getState().reset()
      expect(useComposerStore.getState().input).toBe('')
      expect(useComposerStore.getState().attachments).toEqual([])
      expect(useComposerStore.getState().branchMenuOpen).toBe(false)
    })
  })
})
