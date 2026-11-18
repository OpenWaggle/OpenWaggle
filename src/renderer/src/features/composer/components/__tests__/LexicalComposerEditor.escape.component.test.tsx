import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LexicalComposerEditor } from '../LexicalComposerEditor'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: null }) }))

function renderEditor(onEscape: () => void) {
  const editorRef = createRef<LexicalEditor>()
  render(
    <LexicalComposerEditor
      onSubmit={vi.fn()}
      onEscape={onEscape}
      placeholder="Ask"
      editorRef={editorRef}
      checkAndConvertPaste={vi.fn(() => false)}
    />,
  )
  return editorRef
}

function pressEscape() {
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), { key: 'Escape' })
}

describe('composer Escape', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  it('reaches onEscape when nothing above the input wants it', () => {
    const onEscape = vi.fn()
    renderEditor(onEscape)

    pressEscape()

    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('leaves Escape to an open picker, which registers above the input', async () => {
    const onEscape = vi.fn()
    const editorRef = renderEditor(onEscape)
    await waitFor(() => expect(editorRef.current).not.toBeNull())
    const closePicker = vi.fn(() => true)
    // The mention typeahead registers exactly like this while it is open.
    act(() => {
      editorRef.current?.registerCommand(KEY_DOWN_COMMAND, closePicker, COMMAND_PRIORITY_HIGH)
    })

    pressEscape()

    expect(closePicker).toHaveBeenCalledOnce()
    expect(onEscape).not.toHaveBeenCalled()
  })
})
