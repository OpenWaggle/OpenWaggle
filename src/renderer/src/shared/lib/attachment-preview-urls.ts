import type { PreparedAttachment } from '@shared/types/agent'
import type { UIMessage } from '@shared/types/chat-ui'
import type { PreparedSelectedAttachment } from '@shared/types/openwaggle-api'

const previewUrls = new Map<string, string>()

export function registerAttachmentPreviewUrls(
  prepared: readonly PreparedSelectedAttachment[],
  files: readonly File[],
) {
  for (const { attachment, fileIndex } of prepared) {
    const file = files[fileIndex]
    if (attachment.kind !== 'image' || !file) continue
    previewUrls.set(attachment.id, URL.createObjectURL(file))
  }
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

export function releaseMessageImagePreviewUrls(message: Pick<UIMessage, 'parts'>) {
  for (const part of message.parts) {
    if (part.type === 'image' && part.source.value.startsWith('blob:')) {
      URL.revokeObjectURL(part.source.value)
    }
  }
}
