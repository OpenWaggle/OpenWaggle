import { invoke, on, prepareSelectedAttachments } from './electron-transport'

/**
 * The attachment methods, kept beside api.ts for its line budget. Pasting a screenshot arrives
 * here as bytes (ADR 0064), so `prepareImageAttachment` is the path a pathless image takes.
 */
export const attachmentApi = {
  prepareAttachments: prepareSelectedAttachments,
  prepareAttachmentFromText: invoke('attachments:prepare-from-text'),
  prepareImageAttachment: invoke('attachments:prepare-image-from-bytes'),
  onPrepareAttachmentFromTextProgress: on('attachments:prepare-from-text-progress'),
}
