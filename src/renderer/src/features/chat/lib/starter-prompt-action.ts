import { createRendererLogger } from '@/shared/lib/logger'
import { refusedSendToast } from './session-image-send-failure'

const logger = createRendererLogger('chat-panel')

export async function sendStarterPrompt(input: {
  readonly content: string
  readonly model: string | undefined
  readonly handleSendText: (content: string) => Promise<void>
  readonly showToast: (message: string, variant?: 'error') => void
}) {
  if (!input.model?.trim()) {
    input.showToast('Select a model before sending.')
    return
  }

  try {
    await input.handleSendText(input.content)
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError)
    // A refusal is expected and says why; anything else is a failure to look into.
    const refused = refusedSendToast(sendError)
    if (refused) {
      logger.warn('The Session Host refused a sent prompt', { error: message })
      input.showToast(refused, 'error')
      return
    }
    logger.error('Failed to send starter prompt', { error: message })
    input.showToast(message)
  }
}
