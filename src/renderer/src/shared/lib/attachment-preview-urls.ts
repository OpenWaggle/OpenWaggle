import type { PreparedAttachment } from '@shared/types/agent'

const previewUrls = new Map<string, string>()

export function registerAttachmentPreviewUrls(
  attachments: readonly PreparedAttachment[],
  files: readonly File[],
) {
  attachments.forEach((attachment, index) => {
    const file = files[index]
    if (attachment.kind !== 'image' || !file) return
    previewUrls.set(attachment.id, URL.createObjectURL(file))
  })
}

export function takeAttachmentPreviewUrl(attachmentId: string) {
  const url = previewUrls.get(attachmentId)
  if (url) previewUrls.delete(attachmentId)
  return url
}

export function releaseAttachmentPreviewUrls(attachments: readonly PreparedAttachment[]) {
  for (const attachment of attachments) {
    const url = previewUrls.get(attachment.id)
    if (!url) continue
    previewUrls.delete(attachment.id)
    URL.revokeObjectURL(url)
  }
}
