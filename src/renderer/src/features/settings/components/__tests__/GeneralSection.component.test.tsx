import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { UpdateStatus } from '@shared/types/updater'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Hoisted mock handles ---
const {
  getAppVersionMock,
  getUpdateStatusMock,
  onUpdateStatusMock,
  checkForUpdatesMock,
  installUpdateMock,
  updateSettingsMock,
  getCliShimStatusMock,
} = vi.hoisted(() => ({
  getAppVersionMock: vi.fn(),
  getUpdateStatusMock: vi.fn(),
  onUpdateStatusMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  installUpdateMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  getCliShimStatusMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getAppVersion: getAppVersionMock,
    getUpdateStatus: getUpdateStatusMock,
    onUpdateStatus: onUpdateStatusMock,
    checkForUpdates: checkForUpdatesMock,
    installUpdate: installUpdateMock,
    updateSettings: updateSettingsMock,
    getCliShimStatus: getCliShimStatusMock,
  },
}))

vi.mock('../sections/AgentAccessSection', () => ({ AgentAccessSection: () => null }))

import { usePreferencesStore } from '../../state/preferences-store'
import { GeneralSection } from '../sections/GeneralSection'

const setCompactionThresholdPercentMock = vi.fn()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('GeneralSection', () => {
  beforeEach(() => {
    getAppVersionMock.mockReset()
    getUpdateStatusMock.mockReset()
    onUpdateStatusMock.mockReset()
    checkForUpdatesMock.mockReset()
    installUpdateMock.mockReset()
    updateSettingsMock.mockReset()
    getCliShimStatusMock.mockReset()
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'installed',
      commandPath: '/tmp/openwaggle',
      onPath: true,
    })
    setCompactionThresholdPercentMock.mockReset()
    setCompactionThresholdPercentMock.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      setCompactionThresholdPercent: setCompactionThresholdPercentMock,
    })

    getAppVersionMock.mockResolvedValue('0.2.0')
    getUpdateStatusMock.mockResolvedValue({ type: 'idle' } satisfies UpdateStatus)
    onUpdateStatusMock.mockReturnValue(() => {})
    checkForUpdatesMock.mockResolvedValue(undefined)
    installUpdateMock.mockResolvedValue(undefined)
    updateSettingsMock.mockResolvedValue({ ok: true })
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('renders the app version after it resolves', async () => {
    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.getByText(/OpenWaggle v0\.2\.0/)).toBeInTheDocument()
    })
  })

  it('explains a CLI path conflict without offering separate install controls', async () => {
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'conflict',
      commandPath: '/tmp/openwaggle',
      onPath: true,
      detail: 'Another file already uses this path. OpenWaggle will not replace it.',
    })
    render(<GeneralSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('/tmp/openwaggle')
    expect(screen.getByRole('alert')).toHaveTextContent('will not replace it')
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('explains when the bundled CLI did not become available', async () => {
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'not-installed',
      commandPath: '/tmp/openwaggle',
      onPath: false,
    })
    render(<GeneralSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('command is not installed')
    expect(screen.getByRole('alert')).toHaveTextContent('/tmp/openwaggle')
  })

  it('hides the passive packaged-CLI notice in a source build', async () => {
    getCliShimStatusMock.mockResolvedValue(null)
    render(<GeneralSection />)

    await waitFor(() => expect(getCliShimStatusMock).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a stalled automatic setup instead of leaving the notice blank', async () => {
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'unavailable',
      commandPath: null,
      onPath: false,
      detail: 'CLI setup is still running. Reopen Settings to check again.',
    })
    render(<GeneralSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('CLI setup is still running')
  })

  it('explains when the CLI is installed but cannot be found on PATH', async () => {
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'installed',
      commandPath: '/tmp/openwaggle',
      onPath: false,
      detail: 'Existing OpenWaggle app link. Re-run the app installer if the app moves.',
    })
    render(<GeneralSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('OpenWaggle process PATH')
    expect(screen.getByRole('alert')).toHaveTextContent('Your terminal may differ')
  })

  it('offers the global automatic compaction threshold as a compact number stepper', () => {
    render(<GeneralSection />)

    const threshold = screen.getByRole('spinbutton', {
      name: 'Automatic compaction threshold',
    })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(threshold).toHaveValue('80')
    expect(threshold).toHaveAttribute('aria-valuemin', '1')
    expect(threshold).toHaveAttribute('aria-valuemax', '100')
    expect(threshold).toHaveAttribute('aria-valuetext', '80%')

    fireEvent.change(threshold, { target: { value: '73' } })
    fireEvent.blur(threshold)

    expect(setCompactionThresholdPercentMock).toHaveBeenCalledWith(73)
  })

  it('serializes threshold writes so an in-flight failure cannot race a newer value', async () => {
    const firstWrite = deferred<void>()
    setCompactionThresholdPercentMock.mockReturnValueOnce(firstWrite.promise)
    render(<GeneralSection />)

    const threshold = screen.getByRole('spinbutton', {
      name: 'Automatic compaction threshold',
    })
    threshold.focus()
    fireEvent.keyDown(threshold, { key: 'ArrowDown' })

    expect(threshold).toHaveFocus()
    expect(threshold).not.toBeDisabled()
    expect(threshold).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(threshold, { key: 'ArrowDown' })
    expect(setCompactionThresholdPercentMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstWrite.reject(new Error('older write failed'))
      await firstWrite.promise.catch(() => undefined)
    })

    expect(threshold).toHaveFocus()
    expect(threshold).toHaveAttribute('aria-disabled', 'false')
    fireEvent.keyDown(threshold, { key: 'ArrowUp' })
    expect(setCompactionThresholdPercentMock).toHaveBeenNthCalledWith(2, 81)
  })

  it('renders the "About & Updates" section heading', () => {
    render(<GeneralSection />)
    expect(screen.getByText('About & Updates')).toBeInTheDocument()
    expect(screen.queryByText('Agent definitions')).not.toBeInTheDocument()
  })

  it('persists the in-app browser destination from the accessible link setting', async () => {
    render(<GeneralSection />)

    expect(screen.getByRole('radio', { name: 'System browser' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'OpenWaggle' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ browserLinkTarget: 'app' })
      expect(screen.getByRole('radio', { name: 'OpenWaggle' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })
  })

  it('renders the "Check now" button when status is idle', async () => {
    render(<GeneralSection />)

    // The idle status is set synchronously via the initial useState, so the
    // button should be present immediately (before the async getUpdateStatus resolves)
    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
  })

  it('calls api.checkForUpdates when "Check now" is clicked', async () => {
    render(<GeneralSection />)

    fireEvent.click(screen.getByRole('button', { name: /check now/i }))

    await waitFor(() => {
      expect(checkForUpdatesMock).toHaveBeenCalledWith('stable')
    })
  })

  it('persists the update channel through the shared settings store', async () => {
    render(<GeneralSection />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), {
      target: { value: 'alpha' },
    })

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ updateChannel: 'alpha' })
      expect(screen.getByRole('combobox', { name: 'Update channel' })).toHaveValue('alpha')
    })
  })

  it('shows "Restart to update" button when status is downloaded', async () => {
    getUpdateStatusMock.mockResolvedValue({
      type: 'downloaded',
      version: '0.3.0',
    } satisfies UpdateStatus)

    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restart to update/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument()
  })

  it('calls api.installUpdate when "Restart to update" is clicked', async () => {
    getUpdateStatusMock.mockResolvedValue({
      type: 'downloaded',
      version: '0.3.0',
    } satisfies UpdateStatus)

    render(<GeneralSection />)

    fireEvent.click(await screen.findByRole('button', { name: /restart to update/i }))

    await waitFor(() => {
      expect(installUpdateMock).toHaveBeenCalledOnce()
    })
  })

  it('shows "Check now" button when status is not-available', async () => {
    getUpdateStatusMock.mockResolvedValue({ type: 'not-available' } satisfies UpdateStatus)

    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
    })
  })

  it('shows "Check now" button when status is error', async () => {
    getUpdateStatusMock.mockResolvedValue({
      type: 'error',
      message: 'network timeout',
    } satisfies UpdateStatus)

    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
    })
  })

  it('hides action buttons while checking or downloading', async () => {
    getUpdateStatusMock.mockResolvedValue({ type: 'checking' } satisfies UpdateStatus)

    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /restart to update/i })).not.toBeInTheDocument()
    })
  })

  it('renders the "Latest version" label in the status row', () => {
    render(<GeneralSection />)
    expect(screen.getByText('Latest version')).toBeInTheDocument()
  })

  it('subscribes to live update status events via onUpdateStatus', () => {
    render(<GeneralSection />)
    expect(onUpdateStatusMock).toHaveBeenCalledOnce()
  })

  it('calls the unsubscribe function returned by onUpdateStatus on unmount', () => {
    const unsubscribe = vi.fn()
    onUpdateStatusMock.mockReturnValue(unsubscribe)

    const { unmount } = render(<GeneralSection />)
    unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
