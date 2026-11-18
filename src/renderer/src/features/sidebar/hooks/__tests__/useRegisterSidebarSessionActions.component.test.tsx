import { SessionId } from '@shared/types/brand'
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  sidebarSessionActions,
  subscribeSidebarSessionActions,
} from '../../lib/session-actions-registry'
import { useRegisterSidebarSessionActions } from '../useRegisterSidebarSessionActions'

function handlers() {
  return { select: vi.fn(), delete: vi.fn(), archive: vi.fn(), clone: vi.fn(), togglePin: vi.fn() }
}

afterEach(() => vi.restoreAllMocks())

it('registers once and always calls the latest handlers', () => {
  const listener = vi.fn()
  const unsubscribe = subscribeSidebarSessionActions(listener)
  const first = handlers()
  const { rerender, unmount } = renderHook((session) => useRegisterSidebarSessionActions(session), {
    initialProps: first,
  })
  const registered = sidebarSessionActions()
  expect(listener).toHaveBeenCalledTimes(1)

  const second = handlers()
  rerender(second)
  // New handlers do not re-register, so Hive rows are not notified again.
  expect(sidebarSessionActions()).toBe(registered)
  expect(listener).toHaveBeenCalledTimes(1)
  registered?.archive(SessionId('worker'))
  expect(second.archive).toHaveBeenCalledWith(SessionId('worker'))
  expect(first.archive).not.toHaveBeenCalled()

  unmount()
  expect(sidebarSessionActions()).toBeNull()
  unsubscribe()
})
