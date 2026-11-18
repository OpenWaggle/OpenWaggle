import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/queries/query-keys'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { useAgentDefinitions } from '../useAgentDefinitions'

const { listMock, previewMock, toggleMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  previewMock: vi.fn(),
  toggleMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listAgentDefinitionDisplay: listMock,
    getAgentDefinitionPreview: previewMock,
    setAgentDefinitionEnabled: toggleMock,
  },
}))

describe('useAgentDefinitions', () => {
  beforeEach(() => {
    listMock.mockReset()
    previewMock.mockReset()
    toggleMock.mockReset()
  })

  it('settles an in-flight toggle against the project where it began', async () => {
    listMock.mockResolvedValue([])
    let settleToggle: () => void = () => {
      throw new Error('Toggle did not start')
    }
    toggleMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settleToggle = () => resolve()
        }),
    )

    const { client, result, rerender } = renderHookWithQueryClient(
      ({ projectPath }: { projectPath: string }) => useAgentDefinitions(projectPath),
      { initialProps: { projectPath: '/tmp/alpha' } },
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('/tmp/alpha'))

    act(() => result.current.toggleAgent('reviewer', false))
    await waitFor(() => expect(toggleMock).toHaveBeenCalledWith('/tmp/alpha', 'reviewer', false))

    rerender({ projectPath: '/tmp/beta' })
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('/tmp/beta'))
    act(() => settleToggle())

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.agentDefinitions('/tmp/alpha'),
        exact: true,
      }),
    )
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: queryKeys.agentDefinitions('/tmp/beta'),
      exact: true,
    })
  })
})
