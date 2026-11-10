import { describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered, SendFailedOutOfView } from '../message-delivery'
import { sendStarterPrompt } from '../starter-prompt-action'

function send(error: unknown) {
  const showToast = vi.fn()
  return sendStarterPrompt({
    content: 'Explain this repo',
    model: 'openrouter/anthropic/claude-haiku-4.5',
    handleSendText: () => Promise.reject(error),
    showToast,
  }).then(() => showToast)
}

describe('sendStarterPrompt', () => {
  it('says nothing when the person stopped the send', async () => {
    const showToast = await send(new MessageNotDelivered('cancelled'))

    expect(showToast).not.toHaveBeenCalled()
  })

  it('says why the Host refused it', async () => {
    const showToast = await send(
      new MessageNotDelivered('refused', undefined, 'queue_capacity_reached'),
    )

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('(queue_capacity_reached)'))
  })

  it('says a send failed behind another send’s Run did not go', async () => {
    const showToast = await send(new SendFailedOutOfView(new Error('handler died')))

    expect(showToast).toHaveBeenCalledWith('Could not send: handler died')
  })
})
