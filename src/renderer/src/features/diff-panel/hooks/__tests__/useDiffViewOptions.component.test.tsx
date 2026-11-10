import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { useDiffViewOptions } from '../useDiffViewOptions'

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('useDiffViewOptions', () => {
  it('settles a failed diff-view toggle instead of floating its rejection', async () => {
    // The diff panel fires these with `void`, so a transient Settings IPC failure used to
    // surface as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6).
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      setDiffView: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443')),
      setDiffWrapLines: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443')),
    })
    const { result } = renderHook(() => useDiffViewOptions())

    result.current.setDiffView('split')
    result.current.toggleWrapLines()

    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to change the diff view', {
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    )
    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to change line wrapping', {
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    )
  })
})
