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
import {
  BrowserPreviewCaptureTimeoutError,
  captureBrowserPreviewPage,
} from './browser-preview-capture'

const MAX_SCREENSHOT_WIDTH = 1_280
const MAX_SCREENSHOT_HEIGHT = 2_000
const MAX_SCREENSHOT_PIXELS = 1_024 * 768
const PI_INLINE_IMAGE_MAX_BASE64_BYTES = 4.5 * 1_024 * 1_024
const BASE64_INPUT_BYTES = 3
const BASE64_OUTPUT_BYTES = 4
const ACCESSIBILITY_TREE_DEPTH = 8

/** Why no screenshot came back, for a capture failure the rest of the snapshot survives. */
const SCREENSHOT_UNAVAILABLE =
  'The page painted no frame to capture (for example, its window is hidden). Text and elements are current.'

class BrowserPreviewEmptyCaptureError extends Error {
  constructor() {
    super('Browser preview screenshot had invalid dimensions.')
    this.name = 'BrowserPreviewEmptyCaptureError'
  }
}

function constrainImageDimensions(source: NativeImage) {
  const size = source.getSize()
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new BrowserPreviewEmptyCaptureError()
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

/**
 * A page that paints no compositor frame, such as one in a hidden window during automation, times
 * out or captures an empty image. The snapshot then goes without a screenshot instead of failing
 * as a whole; any other capture error, such as a navigation, still fails it.
 */
function unpaintedPage(error: unknown) {
  if (error instanceof BrowserPreviewCaptureTimeoutError) return null
  throw error
}

function boundedScreenshot(source: NativeImage) {
  if (source.isEmpty()) return null
  try {
    const { image, data } = encodeBoundedPng(source)
    const imageSize = image.getSize()
    return {
      mimeType: 'image/png' as const,
      data: data.toString('base64'),
      width: imageSize.width,
      height: imageSize.height,
    }
  } catch (error) {
    if (error instanceof BrowserPreviewEmptyCaptureError) return null
    throw error
  }
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
        }).catch(unpaintedPage),
      ])
      context.assertCurrentDocument()
      const pageData = decodeBrowserPreviewPageSnapshot(pageDataValue)
      const screenshot = sourceImage ? boundedScreenshot(sourceImage) : null
      return {
        ...pageData,
        accessibilityTree: boundedBrowserPreviewAccessibilityTree(accessibility),
        consoleEntries: context.consoleEntries(),
        networkEntries: context.networkEntries(),
        actionTimeline: context.actionTimeline(),
        screenshot,
        ...(screenshot ? {} : { screenshotUnavailable: SCREENSHOT_UNAVAILABLE }),
      }
    },
    { signal },
  )
}
