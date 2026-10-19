import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { transcriptSection } from '../../components/__tests__/transcript-layout.test-harness'
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
