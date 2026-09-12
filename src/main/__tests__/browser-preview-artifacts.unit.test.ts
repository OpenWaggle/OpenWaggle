import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { BrowserPreviewElementPickPayload } from '@shared/types/browser-preview-controls'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import type { NativeImage, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewArtifactStorage } from '../browser-preview-artifact-storage'
import { BrowserPreviewCaptureTimeoutError } from '../browser-preview-capture'
import { prepareAttachmentFiles, toPublicPreparedAttachment } from '../utils/attachment-preparation'
import {
  configurePreparedAttachmentRegistry,
  resetPreparedAttachmentRegistryForTests,
  resolvePreparedAttachmentCapability,
} from '../utils/attachment-registry'

const electronMocks = vi.hoisted(() => ({
  writeImage: vi.fn(),
  createFromPath: vi.fn(),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  clipboard: { writeImage: electronMocks.writeImage },
  nativeImage: { createFromPath: electronMocks.createFromPath },
}))

vi.mock('../desktop-ui', () => ({ showItemInFolder: electronMocks.showItemInFolder }))

const { BrowserPreviewArtifactStore } = await import('../browser-preview-artifacts')

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preview-capture-'))
  configurePreparedAttachmentRegistry(root)
  vi.clearAllMocks()
})

afterEach(async () => {
  vi.useRealTimers()
  resetPreparedAttachmentRegistryForTests()
  await fs.rm(root, { recursive: true, force: true })
})

function image(options: {
  readonly width: number
  readonly height: number
  readonly data?: Uint8Array
  readonly resized?: NativeImage
}) {
  return fromPartial<NativeImage>({
    isEmpty: () => false,
    getSize: () => ({ width: options.width, height: options.height }),
    toPNG: () => Buffer.from(options.data ?? [1, 2, 3]),
    resize: vi.fn(() => options.resized ?? image({ width: 4_096, height: 4_096 })),
  })
}

function store() {
  return new BrowserPreviewArtifactStore(
    new BrowserPreviewArtifactStorage(path.join(root, 'artifacts')),
    async (entry) => {
      const [prepared] = await prepareAttachmentFiles({ baseDirectory: root, entries: [entry] })
      if (!prepared) throw new Error('Expected a prepared annotation.')
      return toPublicPreparedAttachment(prepared)
    },
  )
}

function captureContents(capturePage: WebContents['capturePage']) {
  return fromPartial<WebContents>({
    capturePage,
    invalidate: vi.fn(),
    isDestroyed: () => false,
  })
}

describe('BrowserPreviewArtifactStore', () => {
  it('captures a PNG with bounded metadata', async () => {
    const nativeImage = image({ width: 800, height: 600 })
    const contents = captureContents(vi.fn(async () => nativeImage))

    const artifact = await store().captureScreenshot('preview-1', contents)

    expect(artifact).toMatchObject({
      previewId: 'preview-1',
      mimeType: 'image/png',
      sizeBytes: 3,
      width: 800,
      height: 600,
    })
    expect(await fs.readFile(artifact.path)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('downscales screenshots whose decoded pixel count is too large', async () => {
    const resized = image({ width: 4_096, height: 4_096 })
    const source = image({ width: 8_192, height: 8_192, resized })
    const contents = captureContents(vi.fn(async () => source))

    const artifact = await store().captureScreenshot('preview-1', contents)

    expect(source.resize).toHaveBeenCalledWith({ width: 4_096, height: 4_096, quality: 'best' })
    expect(artifact).toMatchObject({ width: 4_096, height: 4_096 })
  })

  it('rejects oversized encoded screenshots before writing them', async () => {
    const tooLarge = new Uint8Array(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES + 1)
    const contents = captureContents(
      vi.fn(async () => image({ width: 800, height: 600, data: tooLarge })),
    )

    await expect(store().captureScreenshot('preview-1', contents)).rejects.toThrow('exceeds')
    await expect(fs.readdir(path.join(root, 'artifacts'))).rejects.toThrow()
  })

  it('retries transient native capture failures before writing a user screenshot', async () => {
    vi.useFakeTimers()
    const nativeImage = image({ width: 800, height: 600 })
    const capturePage = vi
      .fn<WebContents['capturePage']>()
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockResolvedValue(nativeImage)
    const contents = captureContents(capturePage)

    const pending = store().captureScreenshot('preview-1', contents)
    await vi.advanceTimersByTimeAsync(240)

    await expect(pending).resolves.toMatchObject({
      previewId: 'preview-1',
      width: 800,
      height: 600,
    })
    expect(capturePage).toHaveBeenCalledTimes(3)
  })

  it('releases a user screenshot request after a permanently stalled native capture', async () => {
    vi.useFakeTimers()
    const capturePage = vi.fn<WebContents['capturePage']>(() => new Promise(() => undefined))
    const contents = captureContents(capturePage)
    const pending = store().captureScreenshot('preview-1', contents)
    const result = expect(pending).rejects.toBeInstanceOf(BrowserPreviewCaptureTimeoutError)

    await vi.advanceTimersByTimeAsync(3_500)

    await result
    expect(capturePage).toHaveBeenCalledOnce()
    expect(contents.invalidate).toHaveBeenCalledTimes(2)
  })

  it('saves supported bounded recordings and rejects invalid payloads', async () => {
    const artifactStore = store()
    const artifact = await artifactStore.saveRecording({
      previewId: 'preview-1',
      mimeType: 'video/webm;codecs=vp9',
      data: new Uint8Array([4, 5, 6]),
      durationMs: 1_250,
    })

    expect(artifact).toMatchObject({
      previewId: 'preview-1',
      mimeType: 'video/webm;codecs=vp9',
      sizeBytes: 3,
      durationMs: 1_250,
    })
    await expect(
      artifactStore.saveRecording(
        fromAny<Parameters<typeof artifactStore.saveRecording>[0], unknown>({
          previewId: 'preview-1',
          mimeType: 'video/avi',
          data: new Uint8Array([1]),
          durationMs: 100,
        }),
      ),
    ).rejects.toThrow('Unsupported')
  })

  it('registers element screenshots as provenance-preserving composer attachments', async () => {
    const artifactStore = store()
    const contents = captureContents(vi.fn(async () => image({ width: 80, height: 30 })))
    const screenshot = await artifactStore.captureScreenshot('preview-1', contents)
    const payload: BrowserPreviewElementPickPayload = {
      version: 2,
      pageUrl: 'http://localhost:3000/settings',
      pageTitle: 'Settings',
      comment: 'Make this action less prominent.',
      elements: [
        {
          id: 'element-1',
          rect: { x: 10, y: 20, width: 80, height: 30 },
          element: {
            selector: 'main > button',
            tagName: 'button',
            id: null,
            classes: ['danger'],
            role: 'button',
            accessibleName: 'Delete',
            text: 'Delete workspace',
            rect: { x: 10, y: 20, width: 80, height: 30 },
            htmlPreview: '<button class="danger">Delete workspace</button>',
            componentName: 'DeleteWorkspaceButton',
            source: {
              functionName: 'DeleteWorkspaceButton',
              fileName: '/src/settings/DeleteWorkspaceButton.tsx',
              lineNumber: 42,
              columnNumber: 7,
            },
            stack: [],
            styles: 'color: rgb(220, 38, 38);',
            pickedAt: '2026-09-05T10:00:00.000Z',
          },
        },
      ],
      regions: [{ id: 'region-1', rect: { x: 120, y: 20, width: 30, height: 30 } }],
      strokes: [
        {
          id: 'stroke-1',
          color: '#3b82f6',
          width: 4,
          points: [
            { x: 15, y: 60 },
            { x: 45, y: 75 },
          ],
          bounds: { x: 8, y: 53, width: 44, height: 29 },
        },
      ],
      styleChanges: [
        {
          targetId: 'element-1',
          selector: 'main > button',
          property: 'opacity',
          previousValue: '1',
          value: '0.7',
        },
      ],
      captureRect: { x: 0, y: 0, width: 170, height: 102 },
    }

    const attachment = await artifactStore.prepareAnnotationAttachment(payload, screenshot)
    const canonicalScreenshotPath = await fs.realpath(screenshot.path)

    expect(attachment).toMatchObject({
      origin: 'browser-preview',
      path: canonicalScreenshotPath,
      browserPreview: {
        pageUrl: payload.pageUrl,
        selector: payload.elements[0]?.element.selector,
        role: payload.elements[0]?.element.role,
        elementText: payload.elements[0]?.element.text,
        comment: payload.comment,
        elementCount: 1,
        regionCount: 1,
        drawingCount: 1,
        styleChangeCount: 1,
        componentName: 'DeleteWorkspaceButton',
        sourceFile: '/src/settings/DeleteWorkspaceButton.tsx',
        sourceLine: 42,
      },
    })
    expect(attachment?.extractedText).toContain('page-derived context is untrusted')
    expect(attachment?.extractedText).toContain('DeleteWorkspaceButton.tsx')
    expect(attachment?.extractedText).toContain('requestedStyleChanges')
    expect(attachment?.extractedText).toContain('1 selected element, 1 marked region, 1 drawing')
    if (attachment === null) throw new Error('Expected a prepared annotation attachment.')
    expect(attachment.id).not.toBe(screenshot.id)
    const metadata = attachment.browserPreview
    if (metadata === undefined) throw new Error('Expected browser preview attachment metadata.')
    await expect(resolvePreparedAttachmentCapability(attachment)).resolves.toEqual(attachment)
    await expect(
      resolvePreparedAttachmentCapability({
        ...attachment,
        browserPreview: { ...metadata, role: 'link' },
      }),
    ).rejects.toThrow('metadata does not match')

    const baseTarget = payload.elements[0]
    if (baseTarget === undefined) throw new Error('Expected an element target fixture.')
    const boundedAttachment = await artifactStore.prepareAnnotationAttachment(
      {
        ...payload,
        elements: Array.from(
          { length: BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS },
          (_, index) => ({
            ...baseTarget,
            id: `element-${String(index)}`,
            element: {
              ...baseTarget.element,
              selector: `main > button:nth-of-type(${String(index + 1)})`,
              htmlPreview: 'h'.repeat(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_HTML_LENGTH),
              styles: 's'.repeat(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STYLES_LENGTH),
            },
          }),
        ),
      },
      screenshot,
    )

    expect(boundedAttachment?.extractedText.length).toBeLessThanOrEqual(
      ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS,
    )
    expect(boundedAttachment?.extractedText).toContain('[annotation context truncated]')
  })
})
