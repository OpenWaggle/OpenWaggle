import { describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered } from '../message-delivery'
import { sendStarterPrompt } from '../starter-prompt-action'

/* The transcript's Retry and the starter prompts send through here; it owns their toast. */
describe('sendStarterPrompt', () => {
  it('says why the Session Host refused the send', async () => {
    const showToast = vi.fn()
    const refusal = new MessageNotDelivered(
      'refused',
      'queue_capacity_reached',
      'queue_capacity_reached',
    )

    await sendStarterPrompt({
      content: 'Try again.',
      model: 'provider/model',
      handleSendText: () => Promise.reject(refusal),
      showToast,
    })

    expect(showToast).toHaveBeenCalledWith(
      'Not sent: this Session already has as many queued messages as it can hold.',
      'error',
    )
  })

  it('shows any other failure’s message as before', async () => {
    const showToast = vi.fn()

    await sendStarterPrompt({
      content: 'Try again.',
      model: 'provider/model',
      handleSendText: () => Promise.reject(new Error('Network down')),
      showToast,
    })

    expect(showToast).toHaveBeenCalledWith('Network down')
  })
})
