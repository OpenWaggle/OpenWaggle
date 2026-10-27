import { waitFor } from '@testing-library/react'
import { $getRoot, createEditor, type LexicalEditor, SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../state/composer-store'
import { insertTextAtEditorOrStore } from '../composer-editor-text'
import { clearEditor, setEditorDraft, setEditorText } from '../lexical-utils'

function editorText(editor: LexicalEditor) {
  let text = ''
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })
  return text
}

describe('composer editor text helpers', () => {
  beforeEach(() => {
    useComposerStore.setState({ input: '' })
  })

  it('falls back to appending text through the composer store when no editor is mounted', () => {
    useComposerStore.setState({ input: 'Existing' })
    const setInput = vi.fn()

    insertTextAtEditorOrStore(null, ' text', setInput)

    expect(setInput).toHaveBeenCalledWith('Existing text')
  })

  it('replaces and clears Lexical editor text through the public editor API', async () => {
    const editor = createEditor()

    setEditorText(editor, 'Hello')
    await waitFor(() => expect(editorText(editor)).toBe('Hello'))

    clearEditor(editor)
    await waitFor(() => expect(editorText(editor)).toBe(''))
  })

  it('appends text into the mounted Lexical editor without touching the store setter', async () => {
    const editor = createEditor()
    const setInput = vi.fn()

    setEditorText(editor, 'Hello')
    await waitFor(() => expect(editorText(editor)).toBe('Hello'))
    insertTextAtEditorOrStore(editor, ' world', setInput)

    await waitFor(() => expect(editorText(editor)).toBe('Hello world'))
    expect(setInput).not.toHaveBeenCalled()
  })

  it('restores a draft without the caret scroll check only when asked to', () => {
    const editor = createEditor()
    editor.setRootElement(document.createElement('div'))
    const updateTags: string[][] = []
    editor.registerUpdateListener(({ tags }) => updateTags.push([...tags]))

    // A draft restored as the composer mounts skips Lexical's ancestor-measuring scroll check.
    setEditorDraft(editor, 'Restored', null, { scrollIntoView: false })
    setEditorDraft(editor, 'Typed history', null)

    expect(updateTags).toEqual([[SKIP_SCROLL_INTO_VIEW_TAG], []])
  })
})
