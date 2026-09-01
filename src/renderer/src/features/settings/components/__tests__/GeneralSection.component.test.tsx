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
} = vi.hoisted(() => ({
  getAppVersionMock: vi.fn(),
  getUpdateStatusMock: vi.fn(),
  onUpdateStatusMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  installUpdateMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getAppVersion: getAppVersionMock,
    getUpdateStatus: getUpdateStatusMock,
    onUpdateStatus: onUpdateStatusMock,
    checkForUpdates: checkForUpdatesMock,
    installUpdate: installUpdateMock,
  },
}))

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
  })

  it('renders the app version after it resolves', async () => {
    render(<GeneralSection />)

    await waitFor(() => {
      expect(screen.getByText(/OpenWaggle v0\.2\.0/)).toBeInTheDocument()
    })
  })

  it('updates the global automatic compaction threshold', () => {
    render(<GeneralSection />)

    const threshold = screen.getByRole('spinbutton', { name: 'Automatic compaction threshold' })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(threshold).toHaveAttribute('min', '1')
    expect(threshold).toHaveAttribute('max', '100')
    expect(threshold).toHaveAttribute('step', '1')

    fireEvent.change(threshold, {
      target: { value: '75' },
    })
    expect(setCompactionThresholdPercentMock).not.toHaveBeenCalled()

    fireEvent.blur(threshold)

    expect(setCompactionThresholdPercentMock).toHaveBeenCalledWith(75)
  })

  it('restores the saved compaction threshold when the number is invalid', () => {
    render(<GeneralSection />)

    const threshold = screen.getByRole('spinbutton', {
      name: 'Automatic compaction threshold',
    })
    fireEvent.change(threshold, { target: { value: '101' } })
    fireEvent.blur(threshold)

    expect(threshold).toHaveValue(80)
    expect(setCompactionThresholdPercentMock).not.toHaveBeenCalled()
  })

  it('serializes threshold writes so an in-flight failure cannot race a newer value', async () => {
    const firstWrite = deferred<void>()
    setCompactionThresholdPercentMock.mockReturnValueOnce(firstWrite.promise)
    render(<GeneralSection />)

    const threshold = screen.getByRole('spinbutton', {
      name: 'Automatic compaction threshold',
    })
    fireEvent.change(threshold, { target: { value: '70' } })
    fireEvent.blur(threshold)

    expect(threshold).toBeDisabled()
    fireEvent.change(threshold, { target: { value: '60' } })
    fireEvent.blur(threshold)
    expect(setCompactionThresholdPercentMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstWrite.reject(new Error('older write failed'))
      await firstWrite.promise.catch(() => undefined)
    })

    expect(threshold).not.toBeDisabled()
    fireEvent.change(threshold, { target: { value: '60' } })
    fireEvent.blur(threshold)
    expect(setCompactionThresholdPercentMock).toHaveBeenNthCalledWith(2, 60)
  })

  it('renders the "About & Updates" section heading', () => {
    render(<GeneralSection />)
    expect(screen.getByText('About & Updates')).toBeInTheDocument()
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
      expect(checkForUpdatesMock).toHaveBeenCalledOnce()
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
