import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { LexicalEditor } from 'lexical'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import type { UseFileAttachmentResult } from '../../hooks/useFileAttachment'
import { ComposerDropZone } from '../ComposerDropZone'

function fileAttachment() {
  return fromPartial<UseFileAttachmentResult>({
    isDragOver: false,
    isAtCapacity: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
  })
}

describe('ComposerDropZone', () => {
  it('lifts the composer surface above its dock with restrained token depth', () => {
    const editorRef = createRef<LexicalEditor | null>()
    render(
      <ComposerDropZone editorRef={editorRef} fileAttachment={fileAttachment()}>
        <div contentEditable />
      </ComposerDropZone>,
    )

    expect(screen.getByRole('region', { name: 'Composer file drop zone' })).toHaveClass(
      'z-10',
      'shadow-2xl',
      'shadow-bg/60',
    )
  })

  it('focuses the DOM editor from outer chrome before the Lexical ref is registered', () => {
    const editorRef = createRef<LexicalEditor | null>()
    const { container } = render(
      <ComposerDropZone editorRef={editorRef} fileAttachment={fileAttachment()}>
        <div contentEditable />
      </ComposerDropZone>,
    )

    fireEvent.mouseDown(screen.getByRole('region', { name: 'Composer file drop zone' }))

    expect(container.querySelector('[contenteditable="true"]')).toHaveFocus()
  })

  it('preserves focus for interactive controls inside the composer surface', () => {
    const editorRef = createRef<LexicalEditor | null>()
    const { container } = render(
      <ComposerDropZone editorRef={editorRef} fileAttachment={fileAttachment()}>
        <div contentEditable />
        <Button type="button">Composer action</Button>
        <input aria-label="Composer search" />
      </ComposerDropZone>,
    )

    const editor = container.querySelector('[contenteditable="true"]')
    const button = screen.getByRole('button', { name: 'Composer action' })
    const input = screen.getByRole('textbox', { name: 'Composer search' })

    button.focus()
    fireEvent.mouseDown(button)
    expect(button).toHaveFocus()
    expect(editor).not.toHaveFocus()

    input.focus()
    fireEvent.mouseDown(input)
    expect(input).toHaveFocus()
    expect(editor).not.toHaveFocus()
  })
})
