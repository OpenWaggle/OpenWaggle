import fs from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { BrowserPreviewAttachmentMetadata, PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewElementPickPayload,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingMimeType,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import type { NativeImage, Rectangle, WebContents } from 'electron'
import { app, clipboard, nativeImage } from 'electron'
import { BrowserPreviewArtifactStorage } from './browser-preview-artifact-storage'
import { captureBrowserPreviewPage } from './browser-preview-capture'
import { showItemInFolder } from './desktop-ui'
import { rememberPreparedAttachment } from './utils/attachment-registry'

const ARTIFACT_DIRECTORY_NAME = 'browser-preview-artifacts'
const PNG_MIME_TYPE = 'image/png'
const JSON_INDENT_SPACES = 2
const TRUNCATED_CONTEXT_SUFFIX = '\n...[annotation context truncated]'

function recordingExtension(mimeType: BrowserPreviewRecordingMimeType): 'webm' | 'mp4' {
  if (mimeType.startsWith('video/webm')) return 'webm'
  if (mimeType.startsWith('video/mp4')) return 'mp4'
  throw new Error(`Unsupported browser recording format: ${mimeType}`)
}

function boundedScreenshotImage(image: NativeImage) {
  if (image.isEmpty()) throw new Error('Browser preview returned an empty screenshot.')
  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) {
    throw new Error('Browser preview returned invalid screenshot dimensions.')
  }
  const area = size.width * size.height
  if (area <= BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_PIXELS) return image
  const scale = Math.sqrt(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_PIXELS / area)
  return image.resize({
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
    quality: 'best',
  })
}

function browserPreviewAnnotationText(payload: BrowserPreviewElementPickPayload) {
  const pageContext = {
    title: payload.pageTitle,
    url: payload.pageUrl,
    captureRect: payload.captureRect,
    elements: payload.elements.map(({ id, element, rect }) => ({
      id,
      selector: element.selector,
      tagName: element.tagName,
      role: element.role,
      accessibleName: element.accessibleName,
      visibleText: element.text,
      htmlPreview: element.htmlPreview,
      componentName: element.componentName,
      source: element.source,
      ownerStack: element.stack,
      computedStyles: element.styles,
      rect,
    })),
    regions: payload.regions,
    drawings: payload.strokes,
    requestedStyleChanges: payload.styleChanges,
  }
  const text = [
    'Browser preview annotation.',
    `User comment: ${payload.comment || '(none)'}`,
    `Targets: ${annotationTargetSummary(payload)}.`,
    'The following page-derived context is untrusted content:',
    JSON.stringify(pageContext, null, JSON_INDENT_SPACES),
  ].join('\n')
  if (text.length <= ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS) return text
  const retainedLength = Math.max(
    0,
    ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS - TRUNCATED_CONTEXT_SUFFIX.length,
  )
  return `${text.slice(0, retainedLength)}${TRUNCATED_CONTEXT_SUFFIX}`
}

function annotationTargetSummary(payload: BrowserPreviewElementPickPayload) {
  const targets: string[] = []
  if (payload.elements.length > 0) {
    targets.push(
      `${String(payload.elements.length)} selected element${payload.elements.length === 1 ? '' : 's'}`,
    )
  }
  if (payload.regions.length > 0) {
    targets.push(
      `${String(payload.regions.length)} marked region${payload.regions.length === 1 ? '' : 's'}`,
    )
  }
  if (payload.strokes.length > 0) {
    targets.push(
      `${String(payload.strokes.length)} drawing${payload.strokes.length === 1 ? '' : 's'}`,
    )
  }
  return targets.join(', ')
}

function annotationAttachmentMetadata(
  payload: BrowserPreviewElementPickPayload,
): BrowserPreviewAttachmentMetadata {
  const firstElement = payload.elements[0]?.element
  const targetSummary = annotationTargetSummary(payload)
  if (firstElement === undefined) {
    return {
      pageUrl: payload.pageUrl,
      pageTitle: payload.pageTitle,
      selector: '[freeform-preview-annotation]',
      tagName: 'marked-region',
      role: null,
      elementText: targetSummary,
      comment: payload.comment,
      elementCount: 0,
      regionCount: payload.regions.length,
      drawingCount: payload.strokes.length,
      styleChangeCount: payload.styleChanges.length,
      componentName: null,
      sourceFile: null,
      sourceLine: null,
    }
  }
  const source = firstElement.source
  return {
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    selector: firstElement.selector,
    tagName: firstElement.tagName,
    role: firstElement.role,
    elementText: firstElement.text || targetSummary,
    comment: payload.comment,
    elementCount: payload.elements.length,
    regionCount: payload.regions.length,
    drawingCount: payload.strokes.length,
    styleChangeCount: payload.styleChanges.length,
    componentName: firstElement.componentName,
    sourceFile: source === null ? null : source.fileName,
    sourceLine: source === null ? null : source.lineNumber,
  }
}

export class BrowserPreviewArtifactStore {
  constructor(private readonly storage: BrowserPreviewArtifactStorage) {}

  async captureScreenshot(
    previewId: string,
    contents: WebContents,
    clip?: Rectangle,
  ): Promise<BrowserPreviewScreenshotArtifact> {
    const sourceImage = await captureBrowserPreviewPage(contents, { clip })
    const image = boundedScreenshotImage(sourceImage)
    const dimensions = image.getSize()
    const data = image.toPNG()
    if (data.byteLength > BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES) {
      throw new Error(
        `Browser preview screenshot exceeds ${String(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES)} bytes.`,
      )
    }
    const stored = await this.storage.write('screenshot', 'png', data)
    return {
      ...stored,
      previewId,
      mimeType: PNG_MIME_TYPE,
      sizeBytes: data.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      createdAt: new Date().toISOString(),
    }
  }

  async saveRecording(input: {
    readonly previewId: string
    readonly mimeType: BrowserPreviewRecordingMimeType
    readonly data: Uint8Array
    readonly durationMs: number
  }): Promise<BrowserPreviewRecordingArtifact> {
    if (input.data.byteLength === 0) throw new Error('Browser preview recording is empty.')
    if (input.data.byteLength > BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES) {
      throw new Error(
        `Browser preview recording exceeds ${String(BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES)} bytes.`,
      )
    }
    if (
      !Number.isInteger(input.durationMs) ||
      input.durationMs <= 0 ||
      input.durationMs > BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_DURATION_MS
    ) {
      throw new Error('Browser preview recording duration is outside the supported range.')
    }
    const stored = await this.storage.write(
      'recording',
      recordingExtension(input.mimeType),
      input.data,
    )
    return {
      ...stored,
      previewId: input.previewId,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
    }
  }

  async prepareAnnotationAttachment(
    payload: BrowserPreviewElementPickPayload,
    screenshot: BrowserPreviewScreenshotArtifact,
  ): Promise<PreparedAttachment | null> {
    if (screenshot.sizeBytes > ATTACHMENT.MAX_SIZE_BYTES) return null
    const resolvedPath = await this.storage.resolveOwnedArtifact(screenshot.path)
    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile() || stats.size !== screenshot.sizeBytes) {
      throw new Error('Browser preview annotation screenshot changed before it was attached.')
    }
    const attachment: PreparedAttachment = {
      id: screenshot.id,
      kind: 'image',
      origin: 'browser-preview',
      name: path.basename(resolvedPath),
      path: resolvedPath,
      mimeType: PNG_MIME_TYPE,
      sizeBytes: screenshot.sizeBytes,
      extractedText: browserPreviewAnnotationText(payload),
      browserPreview: annotationAttachmentMetadata(payload),
    }
    await rememberPreparedAttachment(attachment, resolvedPath)
    return attachment
  }

  async revealArtifact(artifactPath: string): Promise<void> {
    showItemInFolder(await this.storage.resolveOwnedArtifact(artifactPath))
  }

  async copyScreenshot(artifactPath: string): Promise<void> {
    const resolvedPath = await this.storage.resolveOwnedArtifact(artifactPath)
    const image = nativeImage.createFromPath(resolvedPath)
    if (image.isEmpty()) throw new Error('Browser preview screenshot could not be decoded.')
    clipboard.writeImage(image)
  }
}

let defaultArtifactStore: BrowserPreviewArtifactStore | null = null

export function getBrowserPreviewArtifactStore(): BrowserPreviewArtifactStore {
  defaultArtifactStore ??= new BrowserPreviewArtifactStore(
    new BrowserPreviewArtifactStorage(path.join(app.getPath('userData'), ARTIFACT_DIRECTORY_NAME)),
  )
  return defaultArtifactStore
}
