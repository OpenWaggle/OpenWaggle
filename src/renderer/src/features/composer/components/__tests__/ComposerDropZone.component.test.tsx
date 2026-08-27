import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { LexicalEditor } from 'lexical'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
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
})
