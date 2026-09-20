import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateSettingsMock } = vi.hoisted(() => ({ updateSettingsMock: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { updateSettings: updateSettingsMock } }))

import { usePreferencesStore } from '@/features/settings/state'
import { MultiAgentAccessCard } from '../sections/MultiAgentAccessCard'

describe('MultiAgentAccessCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    updateSettingsMock.mockResolvedValue({ ok: true })
    const initial = usePreferencesStore.getInitialState()
    usePreferencesStore.setState({
      ...initial,
      settings: { ...initial.settings, projectPath: '/tmp/project' },
    })
  })

  it('keeps everyday Hive controls and hides host and per-project tuning', async () => {
    render(<MultiAgentAccessCard />)

    expect(screen.getByRole('switch', { name: 'Allow agents to create Workers' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Increase Workers per parent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Increase Active agent runs' })).toBeInTheDocument()
    expect(screen.queryByText('Host idle grace (ms)')).not.toBeInTheDocument()
    expect(screen.queryByText('Current project agents')).not.toBeInTheDocument()

    const runs = screen.getByRole('spinbutton', { name: 'Active agent runs' })
    fireEvent.change(runs, { target: { value: '100' } })
    fireEvent.blur(runs)

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ sessionHostRunCeiling: 100 })
    })
  })

  it('exposes a recovery path for saved project overrides that supersede global controls', async () => {
    const settings = usePreferencesStore.getState().settings
    usePreferencesStore.setState({
      settings: {
        ...settings,
        multiAgentEnabledByProject: { '/tmp/project': false },
        sessionHostParentConcurrencyLimitsByProject: { '/tmp/project': 2 },
      },
    })
    render(<MultiAgentAccessCard />)

    expect(screen.getByText('Saved project overrides (1)')).toBeInTheDocument()
    expect(
      screen
        .getByText('Saved project overrides (1)')
        .closest('details')
        ?.querySelector('.overflow-y-auto'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Saved project overrides (1)'))
    expect(
      screen.getByText(/project configuration files take precedence over both/),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved Worker permission for /tmp/project' }),
    )
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({ multiAgentEnabledByProject: {} }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear saved Worker limit for /tmp/project' }),
    )
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        sessionHostParentConcurrencyLimitsByProject: {},
      }),
    )
  })
})
