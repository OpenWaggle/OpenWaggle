import { waitFor } from '@testing-library/react'
import { $getRoot, createEditor, type LexicalEditor } from 'lexical'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '../../state/composer-store'
import { insertTextAtEditorOrStore } from '../composer-editor-text'
import { clearEditor, setEditorText } from '../lexical-utils'

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
})
