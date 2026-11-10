import { renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { transcriptSection } from '../../components/__tests__/transcript-layout.test-harness'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useStableRowContext } from '../useStableRowContext'

it('follows copiesBlocked as a Run starts and settles, keeping its callbacks', () => {
  const { result, rerender } = renderHook(
    ({ copiesBlocked }) => useStableRowContext(transcriptSection([], { copiesBlocked })),
    { initialProps: { copiesBlocked: false } },
  )
  const idle = result.current

  rerender({ copiesBlocked: true })
  const running = result.current
  rerender({ copiesBlocked: true })

  expect(idle.actions.copiesBlocked).toBe(false)
  expect(running.actions.copiesBlocked).toBe(true)
  expect(result.current).toBe(running)
  expect(running.actions.onForkFromResponse).toBe(idle.actions.onForkFromResponse)

  rerender({ copiesBlocked: false })
  expect(result.current.actions.copiesBlocked).toBe(false)
})

it('says why the Session Host refused a Retry from the error banner', async () => {
  const refusal = new MessageNotDelivered(
    'refused',
    'queue_capacity_reached',
    'queue_capacity_reached',
  )
  const onRetryText = () => Promise.reject(refusal)
  const { result } = renderHook(() => useStableRowContext(transcriptSection([], { onRetryText })))

  result.current.onRetry?.('Try again.')

  await waitFor(() =>
    expect(useUIStore.getState().toastMessage).toBe(
      'Not sent: this Session already has as many queued messages as it can hold.',
    ),
  )
})
