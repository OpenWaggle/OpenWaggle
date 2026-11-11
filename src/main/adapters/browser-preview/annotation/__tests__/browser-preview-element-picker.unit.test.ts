import { Script } from 'node:vm'
import type { PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewElementPicker,
  type BrowserPreviewPickerPage,
} from '../browser-preview-element-picker'
import {
  BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT,
} from '../browser-preview-element-picker-script'

const payload: BrowserPreviewElementPickPayload = {
  version: 2,
  pageUrl: 'http://localhost:3000/account',
  pageTitle: 'Account',
  comment: 'Align this with the heading.',
  elements: [
    {
      id: 'element-1',
      rect: { x: 12.25, y: 20.5, width: 80.5, height: 31.25 },
      element: {
        selector: 'main > button:nth-of-type(2)',
        tagName: 'button',
        id: null,
        classes: ['primary'],
        role: 'button',
        accessibleName: 'Save',
        text: 'Save',
        rect: { x: 12.25, y: 20.5, width: 80.5, height: 31.25 },
        htmlPreview: '<button class="primary">Save</button>',
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
  captureRect: { x: 12.25, y: 20.5, width: 80.5, height: 31.25 },
}

const screenshot: BrowserPreviewScreenshotArtifact = {
  id: 'screenshot-1',
  previewId: 'preview-1',
  path: '/private/browser-screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 4,
  width: 81,
  height: 32,
  createdAt: '2026-09-05T10:00:00.000Z',
}

const attachment: PreparedAttachment = {
  id: screenshot.id,
  kind: 'image',
  origin: 'browser-preview',
  name: 'browser-screenshot.png',
  path: screenshot.path,
  mimeType: screenshot.mimeType,
  sizeBytes: screenshot.sizeBytes,
  extractedText: 'Browser preview annotation.',
  browserPreview: {
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    selector: 'main > button:nth-of-type(2)',
    tagName: 'button',
    role: 'button',
    elementText: 'Save',
    comment: payload.comment,
  },
}

function fakePage(runPicker: (script: string) => Promise<unknown>) {
  let retired = false
  const page = {
    assertAvailable: () => {
      if (retired) throw new Error('Browser preview content was retired.')
    },
    isDestroyed: () => false,
    runPicker: vi.fn(runPicker),
    runControl: vi.fn(async (_script: string): Promise<unknown> => true),
    captureScreenshot: vi.fn(async () => screenshot),
  } satisfies BrowserPreviewPickerPage
  return { page, retire: () => (retired = true) }
}

function fixture(result: unknown = payload) {
  const { page, retire } = fakePage(async () => result)
  const prepareAttachment = vi.fn(async () => attachment)
  return {
    page,
    retire,
    prepareAttachment,
    picker: new BrowserPreviewElementPicker(prepareAttachment),
  }
}

describe('BrowserPreviewElementPicker', () => {
  it('ships a syntactically valid isolated-world controller', () => {
    expect(() => new Script(BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT)).not.toThrow()
  })

  it('collects validated page context in an isolated world and attaches a cropped screenshot', async () => {
    const { page, picker, prepareAttachment } = fixture()

    const annotation = await picker.pick('owner-1:preview-1', 'preview-1', page)

    expect(page.runPicker).toHaveBeenCalledWith(BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT)
    expect(page.captureScreenshot).toHaveBeenCalledWith({ x: 12, y: 20, width: 81, height: 32 })
    expect(prepareAttachment).toHaveBeenCalledWith(payload, screenshot)
    expect(annotation).toMatchObject({
      previewId: 'preview-1',
      pageUrl: payload.pageUrl,
      element: payload.elements[0]?.element,
      elements: payload.elements,
      screenshot,
      attachment,
    })
    expect(page.runControl).toHaveBeenCalledWith(BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT)
  })

  it('rejects malformed or oversized page-derived picker results before capture', async () => {
    const { page, picker } = fixture({
      ...payload,
      elements: payload.elements.map((target) => ({
        ...target,
        element: { ...target.element, selector: 'x'.repeat(2_049) },
      })),
    })

    await expect(picker.pick('owner-1:preview-1', 'preview-1', page)).rejects.toThrow(
      'returned invalid data',
    )
    expect(page.captureScreenshot).not.toHaveBeenCalled()
  })

  it('treats in-page cancellation as a normal null result', async () => {
    const { page, picker } = fixture(null)

    await expect(picker.pick('owner-1:preview-1', 'preview-1', page)).resolves.toBeNull()
    expect(page.captureScreenshot).not.toHaveBeenCalled()
  })

  it('actively cancels an outstanding picker and ignores its stale result', async () => {
    const pick = Promise.withResolvers<unknown>()
    const { page } = fakePage(() => pick.promise)
    const picker = new BrowserPreviewElementPicker(async () => attachment)
    const pending = picker.pick('owner-1:preview-1', 'preview-1', page)

    await picker.cancel('owner-1:preview-1')
    pick.resolve(payload)

    await expect(pending).resolves.toBeNull()
    expect(page.runControl).toHaveBeenCalledWith(BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT)
    expect(page.captureScreenshot).not.toHaveBeenCalled()
  })

  it('finishes cancellation even when the page JavaScript thread stops responding', async () => {
    vi.useFakeTimers()
    try {
      const { page } = fakePage(() => new Promise<unknown>(() => undefined))
      page.runControl.mockImplementation(() => new Promise<unknown>(() => undefined))
      const picker = new BrowserPreviewElementPicker(async () => attachment)
      const pendingPick = picker.pick('owner-1:preview-1', 'preview-1', page)
      const pendingCancel = picker.cancel('owner-1:preview-1')

      await vi.runAllTimersAsync()

      await expect(pendingCancel).resolves.toBeUndefined()
      await expect(pendingPick).resolves.toBeNull()
      expect(page.captureScreenshot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps CSS element bounds through zoomed device presentation scale', async () => {
    const { page, picker } = fixture()

    await picker.pick('owner-1:preview-1', 'preview-1', page, 0.5)

    expect(page.captureScreenshot).toHaveBeenCalledWith({ x: 6, y: 10, width: 41, height: 16 })
  })

  it('does not reinstall an element picker after cancellation crosses owner retirement', async () => {
    const nativePick = Promise.withResolvers<unknown>()
    const { page, retire } = fakePage(() => nativePick.promise)
    const picker = new BrowserPreviewElementPicker(async () => attachment)
    const first = picker.pick('owner:preview', 'preview', page)
    const cancelled = Promise.withResolvers<void>()
    const cancel = vi.spyOn(picker, 'cancel').mockReturnValueOnce(cancelled.promise)
    const second = picker.pick('owner:preview', 'preview', page)
    const rejected = expect(second).rejects.toThrow('retired')
    retire()
    cancelled.resolve()
    await rejected
    expect(page.runPicker).toHaveBeenCalledOnce()
    cancel.mockRestore()
    await picker.cancel('owner:preview')
    await first
  })
})
