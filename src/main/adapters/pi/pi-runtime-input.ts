import type { HydratedAgentSendPayload } from '@shared/types/agent'
import type { PiModel } from './pi-provider-catalog'

export interface PiImageContent {
  readonly type: 'image'
  readonly data: string
  readonly mimeType: string
}

export interface PiPromptInput {
  readonly text: string
  readonly images: readonly PiImageContent[]
}

function buildAttachmentSummary(
  attachment: HydratedAgentSendPayload['attachments'][number],
): string {
  const extracted = attachment.extractedText.trim()
  return extracted
    ? `[Attachment: ${attachment.name}]\n${extracted}`
    : `[Attachment: ${attachment.name}]`
}

function buildImageContent(
  attachment: HydratedAgentSendPayload['attachments'][number],
): PiImageContent | null {
  if (attachment.kind !== 'image' || !attachment.source) {
    return null
  }

  return {
    type: 'image',
    data: attachment.source.value,
    mimeType: attachment.source.mimeType,
  }
}

function modelSupportsImage(model: PiModel): boolean {
  return model.input.includes('image')
}

export function buildPiPromptInput(
  model: PiModel,
  payload: HydratedAgentSendPayload,
): PiPromptInput {
  const textParts: string[] = []
  const images: PiImageContent[] = []

  const trimmedText = payload.text.trim()
  if (trimmedText.length > 0) {
    textParts.push(trimmedText)
  }

  for (const attachment of payload.attachments) {
    const image = buildImageContent(attachment)
    if (image && modelSupportsImage(model)) {
      images.push(image)
    }

    textParts.push(buildAttachmentSummary(attachment))
  }

  return {
    text: textParts.join('\n\n').trim(),
    images,
  }
}
