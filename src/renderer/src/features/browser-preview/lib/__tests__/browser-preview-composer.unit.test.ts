import type { PreparedAttachment } from '@shared/types/agent'
import type { BrowserPreviewAnnotation } from '@shared/types/browser-preview-controls'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import {
  activeBrowserPreviewComposerDraft,
  appendBrowserPreviewAnnotationToComposer,
} from '../browser-preview-composer'

function attachment(id = 'annotation-1'): PreparedAttachment {
  return {
    id,
    kind: 'image',
    origin: 'browser-preview',
    name: `${id}.png`,
    path: `/private/${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 10,
    extractedText: 'Browser preview annotation.',
    browserPreview: {
      pageUrl: 'http://localhost:3000',
      pageTitle: 'App',
      selector: 'main > button',
      tagName: 'button',
      role: 'button',
      elementText: 'Save',
      comment: 'Align this.',
    },
  }
}

function annotation(prepared: PreparedAttachment | null = attachment()): BrowserPreviewAnnotation {
  return {
    id: 'pick-1',
    previewId: 'preview-1',
    pageUrl: 'http://localhost:3000',
    pageTitle: 'App',
    comment: 'Align this.',
    element: {
      selector: 'main > button',
      tagName: 'button',
      id: null,
      classes: [],
      role: 'button',
      accessibleName: 'Save',
      text: 'Save',
      rect: { x: 10, y: 10, width: 100, height: 30 },
      htmlPreview: '<button>Save</button>',
      componentName: 'SaveButton',
      source: {
        functionName: 'SaveButton',
        fileName: '/src/SaveButton.tsx',
        lineNumber: 12,
        columnNumber: 5,
      },
      stack: [],
      styles: 'display: inline-flex;',
      pickedAt: '2026-09-05T10:00:00.000Z',
    },
    elements: [
      {
        id: 'element-1',
        rect: { x: 10, y: 10, width: 100, height: 30 },
        element: {
          selector: 'main > button',
          tagName: 'button',
          id: null,
          classes: [],
          role: 'button',
          accessibleName: 'Save',
          text: 'Save',
          rect: { x: 10, y: 10, width: 100, height: 30 },
          htmlPreview: '<button>Save</button>',
          componentName: 'SaveButton',
          source: {
            functionName: 'SaveButton',
            fileName: '/src/SaveButton.tsx',
            lineNumber: 12,
            columnNumber: 5,
          },
          stack: [],
          styles: 'display: inline-flex;',
          pickedAt: '2026-09-05T10:00:00.000Z',
        },
      },
    ],
    regions: [],
    strokes: [],
    styleChanges: [],
    captureRect: { x: 0, y: 0, width: 140, height: 70 },
    createdAt: '2026-09-05T10:00:00.000Z',
    screenshot: null,
    attachment: prepared,
  }
}

describe('browser preview composer annotations', () => {
  beforeEach(() => {
    useComposerStore.getState().reset()
    useComposerStore.setState({ activeDraftContextKey: 'session:one', attachments: [] })
  })

  it('appends a prepared annotation to the same scoped draft', () => {
    const expectedDraft = activeBrowserPreviewComposerDraft()

    appendBrowserPreviewAnnotationToComposer(annotation(), expectedDraft)

    expect(useComposerStore.getState().attachments).toEqual([attachment()])
  })

  it('rejects a result when the user changed drafts while picking', () => {
    useComposerStore.setState({ activeDraftContextKey: 'session:two' })

    expect(() => appendBrowserPreviewAnnotationToComposer(annotation(), 'session:one')).toThrow(
      'active draft changed',
    )
    expect(useComposerStore.getState().attachments).toEqual([])
  })

  it('enforces composer capacity and requires an attachable screenshot', () => {
    useComposerStore.setState({
      attachments: Array.from({ length: 5 }, (_, index) => attachment(`existing-${String(index)}`)),
    })
    expect(() => appendBrowserPreviewAnnotationToComposer(annotation(), 'session:one')).toThrow(
      'maximum 5',
    )

    useComposerStore.setState({ attachments: [] })
    expect(() => appendBrowserPreviewAnnotationToComposer(annotation(null), 'session:one')).toThrow(
      'too large',
    )
  })
})
