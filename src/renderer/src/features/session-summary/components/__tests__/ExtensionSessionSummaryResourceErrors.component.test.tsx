import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import {
  PROJECT_PATH,
  registry,
  sessionResource,
  summaryEntry,
} from './extension-session-summary-test-fixtures'

const apiMocks = vi.hoisted(() => ({
  getSessionResource: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

function renderSummary(resources = [sessionResource('image')]) {
  render(
    <ExtensionSessionSummarySections
      registry={registry([summaryEntry()])}
      projectPaths={[PROJECT_PATH]}
      sessionId="session-one"
      messageCount={1}
      placement="details"
      resources={resources}
      onOpenResources={vi.fn()}
    />,
  )
}

describe('Extension Session Summary resource failures', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.setState({ toastMessage: null, toastData: null, resourceViewer: null })
    apiMocks.getSessionResource.mockReset().mockResolvedValue(null)
    apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
  })

  it('reports a rejected exact-resource lookup instead of leaking the promise', async () => {
    apiMocks.getSessionResource.mockRejectedValue(new Error('Could not read extension resource.'))
    renderSummary([])

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'Could not read extension resource.',
        variant: 'error',
      }),
    )
  })

  it('reports a rejected external resource action instead of leaking the promise', async () => {
    apiMocks.openExternal.mockRejectedValue(new Error('Could not open external resource.'))
    renderSummary([
      {
        ...sessionResource('image'),
        locator: 'http://images.example.com/diagram.png',
        managed: false,
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'Could not open external resource.',
        variant: 'error',
      }),
    )
  })
})
