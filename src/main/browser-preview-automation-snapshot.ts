import type { BrowserPreviewAutomationSnapshot } from '@shared/types/browser-preview-automation'
import type { NativeImage } from 'electron'
import type {
  BrowserPreviewAutomationController,
  BrowserPreviewAutomationPage,
} from './browser-preview-automation-control'
import { browserPreviewSnapshotExpression } from './browser-preview-automation-dom-expressions'
import {
  boundedBrowserPreviewAccessibilityTree,
  decodeBrowserPreviewPageSnapshot,
} from './browser-preview-automation-page-results'
import { captureBrowserPreviewPage } from './browser-preview-capture'

const MAX_SCREENSHOT_WIDTH = 1_280
const MAX_SCREENSHOT_HEIGHT = 2_000
const MAX_SCREENSHOT_PIXELS = 1_024 * 768
const PI_INLINE_IMAGE_MAX_BASE64_BYTES = 4.5 * 1_024 * 1_024
const BASE64_INPUT_BYTES = 3
const BASE64_OUTPUT_BYTES = 4
const ACCESSIBILITY_TREE_DEPTH = 8

function constrainImageDimensions(source: NativeImage) {
  const size = source.getSize()
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new Error('Browser preview screenshot had invalid dimensions.')
  }
  const pixelScale = Math.sqrt(MAX_SCREENSHOT_PIXELS / (size.width * size.height))
  const widthScale = MAX_SCREENSHOT_WIDTH / size.width
  const heightScale = MAX_SCREENSHOT_HEIGHT / size.height
  const scale = Math.min(1, pixelScale, widthScale, heightScale)
  return scale < 1
    ? source.resize({
        width: Math.max(1, Math.floor(size.width * scale)),
        height: Math.max(1, Math.floor(size.height * scale)),
      })
    : source
}

function encodeBoundedPng(source: NativeImage) {
  const image = constrainImageDimensions(source)
  const data = image.toPNG()
  const base64Bytes = Math.ceil(data.byteLength / BASE64_INPUT_BYTES) * BASE64_OUTPUT_BYTES
  if (base64Bytes >= PI_INLINE_IMAGE_MAX_BASE64_BYTES) {
    throw new Error('Browser preview screenshot exceeded the inline image limit.')
  }
  return { image, data }
}

export function captureBrowserPreviewAutomationSnapshot(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  signal?: AbortSignal,
): Promise<BrowserPreviewAutomationSnapshot> {
  return controller.run(
    page,
    'snapshot',
    async (context) => {
      const documentGeneration = context.documentGeneration()
      const [pageDataValue, accessibility, sourceImage] = await Promise.all([
        context.evaluate(browserPreviewSnapshotExpression()),
        context.send('Accessibility.getFullAXTree', { depth: ACCESSIBILITY_TREE_DEPTH }),
        captureBrowserPreviewPage(page.contents, {
          signal: context.signal,
          assertCurrent: () => {
            if (context.documentGeneration() !== documentGeneration) {
              context.assertCurrentDocument()
            }
          },
        }),
      ])
      context.assertCurrentDocument()
      const pageData = decodeBrowserPreviewPageSnapshot(pageDataValue)
      const { image, data } = encodeBoundedPng(sourceImage)
      const imageSize = image.getSize()
      return {
        ...pageData,
        accessibilityTree: boundedBrowserPreviewAccessibilityTree(accessibility),
        consoleEntries: context.consoleEntries(),
        networkEntries: context.networkEntries(),
        actionTimeline: context.actionTimeline(),
        screenshot: {
          mimeType: 'image/png',
          data: data.toString('base64'),
          width: imageSize.width,
          height: imageSize.height,
        },
      }
    },
    { signal },
  )
}
