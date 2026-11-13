import fs from 'node:fs/promises'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { BrowserPreviewAttachmentMetadata, PreparedAttachment } from '@shared/types/agent'
import type {
  BrowserPreviewElementPickPayload,
  BrowserPreviewScreenshotArtifact,
} from '@shared/types/browser-preview-controls'
import {
  type BrowserPreviewAnnotationAttachmentInput,
  prepareBrowserPreviewAnnotationAttachment,
} from './browser-preview-annotation-attachment'
import type { BrowserPreviewArtifactStorage } from '../browser-preview-artifact-storage'
import { rememberPreparedAttachment } from '../../../utils/attachment-registry'

const JSON_INDENT_SPACES = 2
const TRUNCATED_CONTEXT_SUFFIX = '\n...[annotation context truncated]'

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

function annotationAttachmentMetadata(payload: BrowserPreviewElementPickPayload) {
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
    } satisfies BrowserPreviewAttachmentMetadata
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
  } satisfies BrowserPreviewAttachmentMetadata
}

export type PrepareBrowserPreviewAnnotation = (
  input: BrowserPreviewAnnotationAttachmentInput,
) => Promise<PreparedAttachment>

/**
 * Turns an annotation's screenshot into a composer attachment the Session Host has committed, with
 * the page-derived context as bounded, untrusted text. `null` when the screenshot is too large to
 * attach.
 */
export async function prepareBrowserPreviewAnnotation(
  storage: BrowserPreviewArtifactStorage,
  payload: BrowserPreviewElementPickPayload,
  screenshot: BrowserPreviewScreenshotArtifact,
  prepare: PrepareBrowserPreviewAnnotation = prepareBrowserPreviewAnnotationAttachment,
) {
  if (screenshot.sizeBytes > ATTACHMENT.MAX_SIZE_BYTES) return null
  const resolvedPath = await storage.resolveOwnedArtifact(screenshot.path)
  const stats = await fs.stat(resolvedPath)
  if (!stats.isFile() || stats.size !== screenshot.sizeBytes) {
    throw new Error('Browser preview annotation screenshot changed before it was attached.')
  }
  const attachment = await prepare({
    origin: 'browser-preview',
    path: resolvedPath,
    browserAnnotationText: browserPreviewAnnotationText(payload),
    browserPreview: annotationAttachmentMetadata(payload),
  })
  await rememberPreparedAttachment(attachment, attachment.path)
  return attachment
}
