import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('chat-panel')

export async function sendStarterPrompt(input: {
  readonly content: string
  readonly model: string
  readonly handleSendText: (content: string) => Promise<void>
  readonly showToast: (message: string) => void
}) {
  if (!input.model.trim()) {
    input.showToast('Select a model before sending.')
    return
  }

  try {
    await input.handleSendText(input.content)
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError)
    logger.error('Failed to send starter prompt', { error: message })
    input.showToast(message)
  }
}
