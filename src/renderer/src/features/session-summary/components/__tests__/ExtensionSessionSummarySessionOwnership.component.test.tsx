import type { SessionResource } from '@shared/types/session-resource'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import {
  PROJECT_PATH,
  registry,
  sessionResource,
  summaryEntry,
} from './extension-session-summary-test-fixtures'

const getSessionResource = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionResource } }))
vi.mock('@/features/extensions', () => ({
  ExtensionDialogSurface: () => null,
  invokeBoundExtension: vi.fn(),
}))

function deferred<T>() {
  let settle: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (!settle) throw new Error('Deferred promise was not initialized.')
      settle(value)
    },
  }
}

function summary(sessionId: string, onOpenResources: () => void) {
  return (
    <ExtensionSessionSummarySections
      registry={registry([summaryEntry()])}
      projectPaths={[PROJECT_PATH]}
      sessionId={sessionId}
      messageCount={1}
      placement="details"
      resources={[]}
      onOpenResources={onOpenResources}
    />
  )
}

describe('Extension Session Summary action ownership', () => {
  beforeEach(() => {
    getSessionResource.mockReset()
    useUIStore.setState({ resourceViewer: null, toastMessage: null, toastData: null })
  })

  it('ignores a resource lookup that finishes after the opened Session changes', async () => {
    const pending = deferred<SessionResource | null>()
    const openSessionOneResources = vi.fn()
    const openSessionTwoResources = vi.fn()
    getSessionResource.mockReturnValueOnce(pending.promise)
    const view = render(summary('session-one', openSessionOneResources))

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(getSessionResource).toHaveBeenCalledWith('session-one', 'resource-one', 'all'),
    )

    view.rerender(summary('session-two', openSessionTwoResources))
    await act(async () => {
      pending.resolve(sessionResource('file', 'session-one'))
      await pending.promise
    })

    expect(openSessionOneResources).not.toHaveBeenCalled()
    expect(openSessionTwoResources).not.toHaveBeenCalled()
    expect(useUIStore.getState().resourceViewer).toBeNull()
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('lets the latest same-Session action supersede an older pending lookup', async () => {
    const firstLookup = deferred<SessionResource | null>()
    const secondLookup = deferred<SessionResource | null>()
    const openResources = vi.fn()
    getSessionResource
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(secondLookup.promise)
    render(summary('session-one', openResources))

    const preview = screen.getByRole('button', { name: 'Preview' })
    fireEvent.click(preview)
    fireEvent.click(preview)
    await waitFor(() => expect(getSessionResource).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstLookup.resolve(sessionResource('file', 'session-one'))
      await firstLookup.promise
    })
    expect(openResources).not.toHaveBeenCalled()

    await act(async () => {
      secondLookup.resolve(sessionResource('file', 'session-one'))
      await secondLookup.promise
    })
    expect(openResources).toHaveBeenCalledOnce()
    expect(openResources).toHaveBeenCalledWith({
      view: 'outputs',
      resourceId: 'resource-one',
    })
  })
})
