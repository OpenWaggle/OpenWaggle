import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import type {
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserPreviewArtifactStorage } from '../../browser-preview-artifact-storage'
import { annotationPayload } from './browser-preview-annotation.test-fixtures'
import { prepareBrowserPreviewAnnotation } from '../browser-preview-annotation'
import {
  prepareAttachmentFiles,
  toPublicPreparedAttachment,
} from '../../../../utils/attachment-preparation'
import {
  configurePreparedAttachmentRegistry,
  resetPreparedAttachmentRegistryForTests,
  resolvePreparedAttachmentCapability,
} from '../../../../utils/attachment-registry'

let root = ''
let storage: BrowserPreviewArtifactStorage

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preview-annotation-'))
  configurePreparedAttachmentRegistry(root)
  storage = new BrowserPreviewArtifactStorage(path.join(root, 'artifacts'))
})

afterEach(async () => {
  resetPreparedAttachmentRegistryForTests()
  await fs.rm(root, { recursive: true, force: true })
})

async function storedScreenshot(): Promise<BrowserPreviewScreenshotArtifact> {
  const data = Buffer.from([1, 2, 3])
  const stored = await storage.write('screenshot', 'png', data)
  return {
    ...stored,
    previewId: 'preview-1',
    mimeType: 'image/png',
    sizeBytes: data.byteLength,
    width: 80,
    height: 30,
    createdAt: new Date().toISOString(),
  }
}

function prepare(
  payload: BrowserPreviewElementPickPayload,
  screenshot: BrowserPreviewScreenshotArtifact,
) {
  return prepareBrowserPreviewAnnotation(storage, payload, screenshot, async (entry) => {
    const [prepared] = await prepareAttachmentFiles({ baseDirectory: root, entries: [entry] })
    if (!prepared) throw new Error('Expected a prepared annotation.')
    return toPublicPreparedAttachment(prepared)
  })
}

describe('prepareBrowserPreviewAnnotation', () => {
  it('registers element screenshots as provenance-preserving composer attachments', async () => {
    const screenshot = await storedScreenshot()
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

    const attachment = await prepare(payload, screenshot)
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
    const boundedAttachment = await prepare(
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
  it('refuses a screenshot that changed after it was captured', async () => {
    const screenshot = await storedScreenshot()
    await fs.writeFile(screenshot.path, Buffer.from([1, 2, 3, 4]))

    await expect(prepare(annotationPayload(), screenshot)).rejects.toThrow('changed before')
  })
})
