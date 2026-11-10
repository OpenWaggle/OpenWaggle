import { Script } from 'node:vm'
import type { PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewElementPicker } from '../browser-preview-element-picker'
import {
  BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
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

function fixture(result: unknown = payload) {
  const executeJavaScriptInIsolatedWorld = vi.fn(async () => result)
  const contents = fromPartial<WebContents>({
    capturePage: vi.fn(),
    executeJavaScriptInIsolatedWorld,
    isDestroyed: () => false,
  })
  const artifacts = {
    captureScreenshot: vi.fn(async () => screenshot),
    prepareAnnotationAttachment: vi.fn(async () => attachment),
  }
  return { artifacts, contents, executeJavaScriptInIsolatedWorld }
}

describe('BrowserPreviewElementPicker', () => {
  it('ships a syntactically valid isolated-world controller', () => {
    expect(() => new Script(BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT)).not.toThrow()
  })

  it('collects validated page context in an isolated world and attaches a cropped screenshot', async () => {
    const { artifacts, contents, executeJavaScriptInIsolatedWorld } = fixture()
    const picker = new BrowserPreviewElementPicker(artifacts)

    const annotation = await picker.pick('owner-1:preview-1', 'preview-1', contents)

    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
      [{ code: BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT }],
      true,
    )
    expect(artifacts.captureScreenshot).toHaveBeenCalledWith('preview-1', contents, {
      x: 12,
      y: 20,
      width: 81,
      height: 32,
    })
    expect(artifacts.prepareAnnotationAttachment).toHaveBeenCalledWith(payload, screenshot)
    expect(annotation).toMatchObject({
      previewId: 'preview-1',
      pageUrl: payload.pageUrl,
      element: payload.elements[0]?.element,
      elements: payload.elements,
      screenshot,
      attachment,
    })
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
      [{ code: BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT }],
      true,
    )
  })

  it('rejects malformed or oversized page-derived picker results before capture', async () => {
    const { artifacts, contents } = fixture({
      ...payload,
      elements: payload.elements.map((target) => ({
        ...target,
        element: { ...target.element, selector: 'x'.repeat(2_049) },
      })),
    })
    const picker = new BrowserPreviewElementPicker(artifacts)

    await expect(picker.pick('owner-1:preview-1', 'preview-1', contents)).rejects.toThrow(
      'returned invalid data',
    )
    expect(artifacts.captureScreenshot).not.toHaveBeenCalled()
  })

  it('treats in-page cancellation as a normal null result', async () => {
    const { artifacts, contents } = fixture(null)
    const picker = new BrowserPreviewElementPicker(artifacts)

    await expect(picker.pick('owner-1:preview-1', 'preview-1', contents)).resolves.toBeNull()
    expect(artifacts.captureScreenshot).not.toHaveBeenCalled()
  })

  it('actively cancels an outstanding picker and ignores its stale result', async () => {
    let resolvePick: (value: unknown) => void = () => {
      throw new Error('Picker promise was not created.')
    }
    const executeJavaScriptInIsolatedWorld = vi.fn(
      (_worldId: number, scripts: Array<{ readonly code: string }>) => {
        if (
          scripts[0]?.code === BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT ||
          scripts[0]?.code === BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT
        ) {
          return Promise.resolve(true)
        }
        return new Promise<unknown>((resolve) => {
          resolvePick = resolve
        })
      },
    )
    const contents = fromPartial<WebContents>({
      capturePage: vi.fn(),
      executeJavaScriptInIsolatedWorld,
      isDestroyed: () => false,
    })
    const artifacts = {
      captureScreenshot: vi.fn(async () => screenshot),
      prepareAnnotationAttachment: vi.fn(async () => attachment),
    }
    const picker = new BrowserPreviewElementPicker(artifacts)
    const pending = picker.pick('owner-1:preview-1', 'preview-1', contents)

    await picker.cancel('owner-1:preview-1')
    resolvePick(payload)

    await expect(pending).resolves.toBeNull()
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      BROWSER_PREVIEW_ELEMENT_PICKER_WORLD_ID,
      [{ code: BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT }],
      true,
    )
    expect(artifacts.captureScreenshot).not.toHaveBeenCalled()
  })

  it('finishes cancellation even when the page JavaScript thread stops responding', async () => {
    vi.useFakeTimers()
    try {
      const executeJavaScriptInIsolatedWorld = vi.fn(() => new Promise<unknown>(() => undefined))
      const contents = fromPartial<WebContents>({
        capturePage: vi.fn(),
        executeJavaScriptInIsolatedWorld,
        isDestroyed: () => false,
      })
      const artifacts = {
        captureScreenshot: vi.fn(async () => screenshot),
        prepareAnnotationAttachment: vi.fn(async () => attachment),
      }
      const picker = new BrowserPreviewElementPicker(artifacts)
      const pendingPick = picker.pick('owner-1:preview-1', 'preview-1', contents)
      const pendingCancel = picker.cancel('owner-1:preview-1')

      await vi.runAllTimersAsync()

      await expect(pendingCancel).resolves.toBeUndefined()
      await expect(pendingPick).resolves.toBeNull()
      expect(artifacts.captureScreenshot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps CSS element bounds through zoomed device presentation scale', async () => {
    const { artifacts, contents } = fixture()
    const picker = new BrowserPreviewElementPicker(artifacts)

    await picker.pick('owner-1:preview-1', 'preview-1', contents, 0.5)

    expect(artifacts.captureScreenshot).toHaveBeenCalledWith('preview-1', contents, {
      x: 6,
      y: 10,
      width: 41,
      height: 16,
    })
  })
})
