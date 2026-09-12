import type { PreparedAttachment } from '@shared/types/agent'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAttachmentChip } from '../BrowserPreviewAttachmentChip'

const attachment: PreparedAttachment & {
  readonly browserPreview: NonNullable<PreparedAttachment['browserPreview']>
} = {
  id: 'annotation-1',
  kind: 'image',
  origin: 'browser-preview',
  name: 'browser-screenshot.png',
  path: '/private/browser-screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 120,
  extractedText: 'Browser preview annotation.',
  browserPreview: {
    pageUrl: 'http://localhost:3000/settings',
    pageTitle: 'Settings',
    selector: 'main > button:nth-of-type(2)',
    tagName: 'button',
    role: 'button',
    elementText: 'Delete workspace',
    comment: 'Make this action less prominent.',
    elementCount: 2,
    regionCount: 1,
    drawingCount: 1,
    styleChangeCount: 3,
    componentName: 'DeleteWorkspaceButton',
    sourceFile: '/workspace/src/settings/DeleteWorkspaceButton.tsx',
    sourceLine: 42,
  },
}

describe('BrowserPreviewAttachmentChip', () => {
  it('surfaces the user comment and page/element provenance', () => {
    const onRemove = vi.fn()
    render(<BrowserPreviewAttachmentChip attachment={attachment} onRemove={onRemove} />)

    expect(screen.getByText('Make this action less prominent.')).toBeInTheDocument()
    expect(
      screen.getByText('Settings · DeleteWorkspaceButton · DeleteWorkspaceButton.tsx:42'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('2 elements · 1 region · 1 drawing · 3 style changes'),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove browser annotation for main > button:nth-of-type(2)',
      }),
    )
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('keeps original single-element attachments readable without rich metadata', () => {
    render(
      <BrowserPreviewAttachmentChip
        attachment={{
          ...attachment,
          browserPreview: {
            pageUrl: 'http://localhost:3000/settings',
            pageTitle: 'Settings',
            selector: 'main > button',
            tagName: 'button',
            role: 'button',
            elementText: 'Save',
            comment: '',
          },
        }}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Settings · button · button')).toBeInTheDocument()
    expect(screen.queryByText(/style change/)).not.toBeInTheDocument()
  })
})
