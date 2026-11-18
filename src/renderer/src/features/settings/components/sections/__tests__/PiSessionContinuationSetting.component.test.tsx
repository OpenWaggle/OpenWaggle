import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { PiSessionContinuationSetting } from '../PiSessionContinuationSetting'

function radio(name: string, index: number) {
  const option = screen.getAllByRole('radio', { name })[index]
  if (!option) throw new Error(`No "${name}" option ${index}.`)
  return option
}

const setProjectPiSessionContinuation = vi.fn(() => Promise.resolve())

beforeEach(() => {
  setProjectPiSessionContinuation.mockClear()
  usePreferencesStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      recentProjects: ['/projects/gosafe'],
      piSessionContinuationByProject: { '/projects/legacy': 'pi' },
    },
    setProjectPiSessionContinuation,
  })
})

describe('PiSessionContinuationSetting', () => {
  it("shows each project's choice and saves a new one for that project only", async () => {
    render(<PiSessionContinuationSetting />)

    const gosafe = screen.getByRole('radiogroup', { name: 'Continue pi sessions of gosafe in' })
    const legacy = screen.getByRole('radiogroup', { name: 'Continue pi sessions of legacy in' })
    expect(gosafe.querySelector('[aria-checked="true"]')?.textContent).toBe('Ask')
    expect(legacy.querySelector('[aria-checked="true"]')?.textContent).toBe('pi')

    fireEvent.click(radio('OpenWaggle', 0))
    await waitFor(() =>
      expect(setProjectPiSessionContinuation).toHaveBeenCalledWith(
        '/projects/gosafe',
        'openwaggle',
      ),
    )

    fireEvent.click(radio('Ask', 1))
    await waitFor(() =>
      expect(setProjectPiSessionContinuation).toHaveBeenCalledWith('/projects/legacy', null),
    )
  })
})
