import type { DesktopNativeRecoveryOutcome } from '@shared/types/openwaggle-desktop-api'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { DesktopNativeAdmissionNotice } from '../DesktopNativeAdmissionNotice'
import { useDesktopNativeAdmissionStore } from '../desktop-native-admission-store'
import { ToastOverlay } from '../ToastOverlay'
import { useUIStore } from '../ui-store'

const mocks = vi.hoisted(() => ({
  getIssue: vi.fn<() => Promise<string | null>>(),
  recover: vi.fn<() => Promise<DesktopNativeRecoveryOutcome>>(),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getDesktopNativeAdmissionIssue: mocks.getIssue,
    recoverDesktopNativeAdmission: mocks.recover,
  },
}))

const ISSUE = 'Desktop tools are paused. If nothing you started is still running, recover them.'
const RECOVER = { name: 'Recover desktop tools' }

function renderNotice(placement: 'top' | 'bottom' = 'top') {
  const view = render(<DesktopNativeAdmissionNotice placement={placement} />)
  act(() => useDesktopNativeAdmissionStore.getState().load())
  return view
}

beforeEach(() => {
  useUIStore.getState().clearToast()
  useDesktopNativeAdmissionStore.setState({ loading: 'idle', notice: { kind: 'hidden' } })
  mocks.getIssue.mockReset().mockResolvedValue(null)
  mocks.recover.mockReset().mockResolvedValue({ outcome: 'recovered' })
})

describe('desktop native admission notice', () => {
  it('renders nothing for a healthy desktop and reads the status once', async () => {
    const { container } = renderNotice()
    act(() => useDesktopNativeAdmissionStore.getState().load())
    await waitFor(() => expect(useDesktopNativeAdmissionStore.getState().loading).toBe('done'))
    expect(mocks.getIssue).toHaveBeenCalledOnce()
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the quarantine and its recovery visible when another toast appears', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    render(<ToastOverlay />)
    renderNotice()
    expect(await screen.findByText(ISSUE)).toBeInTheDocument()
    act(() => useUIStore.getState().showToast('Failed to archive session', 'error'))
    expect(screen.getByText('Failed to archive session')).toBeInTheDocument()
    expect(screen.getByText(ISSUE)).toBeInTheDocument()
    expect(screen.getByRole('button', RECOVER)).toHaveAttribute('aria-disabled', 'false')
    expect(mocks.recover).not.toHaveBeenCalled()
  })

  it('recovers only when the user chooses it, showing progress until it settles', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    const result = Promise.withResolvers<DesktopNativeRecoveryOutcome>()
    mocks.recover.mockReturnValue(result.promise)
    renderNotice()
    render(<Button variant="unstyled">Next control</Button>)
    const button = await screen.findByRole('button', RECOVER)
    button.focus()
    fireEvent.click(button)
    const busy = screen.getByRole('button', { name: 'Recovering…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(busy)
    expect(mocks.recover).toHaveBeenCalledOnce()
    await act(async () => result.resolve({ outcome: 'recovered' }))
    // Confirmed in the existing live region, with focus kept on its Dismiss button.
    expect(screen.getByText(/Desktop tools recovered/)).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('button', { name: /Recover/ })).not.toBeInTheDocument()
    const dismiss = screen.getByRole('button', { name: 'Dismiss desktop tools notice' })
    expect(dismiss).toHaveFocus()
    fireEvent.click(dismiss)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    // Focus moves on to the content after the notice rather than falling to the document.
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
  })

  it('keeps the attestation text and offers a retry after a retryable failure', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    mocks.recover.mockResolvedValue({
      outcome: 'failed',
      message: 'Desktop operations are still settling.',
      retryable: true,
    })
    renderNotice()
    fireEvent.click(await screen.findByRole('button', RECOVER))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Desktop operations are still settling.')
    expect(screen.getByRole('region', { name: 'Desktop tools status' })).toHaveAttribute(
      'aria-describedby',
      alert.id,
    )
    expect(screen.getByText(ISSUE)).toBeInTheDocument()
    const retry = screen.getByRole('button', RECOVER)
    expect(retry).toHaveAttribute('aria-disabled', 'false')
    mocks.recover.mockResolvedValueOnce({ outcome: 'recovered' })
    fireEvent.click(retry)
    expect(await screen.findByText(/Desktop tools recovered/)).toBeInTheDocument()
    expect(mocks.recover).toHaveBeenCalledTimes(2)
  })

  it('drops the action and keeps keyboard focus when recovery cannot succeed', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    mocks.recover.mockResolvedValue({
      outcome: 'failed',
      message: 'Quit and reopen OpenWaggle.',
      retryable: false,
    })
    renderNotice()
    const button = await screen.findByRole('button', RECOVER)
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(await screen.findByText('Quit and reopen OpenWaggle.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Recover/ })).not.toBeInTheDocument()
    // The instruction to choose Recover goes away with the button.
    expect(screen.queryByText(ISSUE)).not.toBeInTheDocument()
    expect(screen.getByText(/cannot be recovered from this window/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Desktop tools status' })).toHaveFocus()
  })

  it('does not take focus when it mounts already unrecoverable', async () => {
    useDesktopNativeAdmissionStore.setState({
      loading: 'done',
      notice: {
        kind: 'quarantined',
        issue: ISSUE,
        failure: 'Quit and reopen OpenWaggle.',
        recoverable: false,
        recovering: false,
      },
    })
    render(<DesktopNativeAdmissionNotice placement="bottom" />)
    expect(screen.getByRole('region', { name: 'Desktop tools status' })).not.toHaveFocus()
  })

  it('shows only the actionable reason of a rejected IPC call', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    mocks.recover.mockRejectedValue(
      new Error("Error invoking remote method 'app:recover-native-admission': Error: Host gone"),
    )
    renderNotice()
    fireEvent.click(await screen.findByRole('button', RECOVER))
    expect(await screen.findByText('Host gone')).toBeInTheDocument()
  })

  it('cannot be dismissed while quarantined, since it is the only way to recover', async () => {
    mocks.getIssue.mockResolvedValue(ISSUE)
    renderNotice()
    expect(await screen.findByText(ISSUE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument()
    act(() => useDesktopNativeAdmissionStore.getState().dismiss())
    expect(screen.getByText(ISSUE)).toBeInTheDocument()
  })

  it('reports an unreadable status safely and lets it be dismissed', async () => {
    mocks.getIssue.mockRejectedValue(new Error('credential=do-not-display'))
    renderNotice('bottom')
    expect(await screen.findByText(/Could not read desktop ownership status/)).toBeInTheDocument()
    expect(screen.queryByText(/credential/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Recover/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss desktop tools notice' }))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('leaves focus alone when the notice is dismissed with a pointer', async () => {
    mocks.getIssue.mockRejectedValue(new Error('unreadable'))
    render(<Button variant="unstyled">Previous control</Button>)
    renderNotice('bottom')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss desktop tools notice' })
    dismiss.focus()
    fireEvent.click(dismiss, { detail: 1 })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous control' })).not.toHaveFocus()
  })

  it('prefers a control in its own column over a toast that follows it', async () => {
    mocks.getIssue.mockRejectedValue(new Error('unreadable'))
    render(
      <>
        <div>
          <Button variant="unstyled">Settings control</Button>
          <DesktopNativeAdmissionNotice placement="bottom" />
        </div>
        <ToastOverlay />
      </>,
    )
    act(() => useDesktopNativeAdmissionStore.getState().load())
    act(() =>
      useUIStore.getState().showActionToast({
        message: 'Saved',
        action: { label: 'Run now', onClick: () => {} },
      }),
    )
    const dismiss = await screen.findByRole('button', { name: 'Dismiss desktop tools notice' })
    dismiss.focus()
    fireEvent.click(dismiss)
    expect(screen.getByRole('button', { name: 'Settings control' })).toHaveFocus()
  })

  it('hands focus back to the nearest usable control when nothing follows it, as in Settings', async () => {
    mocks.getIssue.mockRejectedValue(new Error('unreadable'))
    // Rendered first, so both precede the notice; the inert one stands in for the Settings sidebar.
    render(
      <>
        <div inert>
          <Button variant="unstyled">Inert sidebar control</Button>
        </div>
        <Button variant="unstyled">Previous control</Button>
      </>,
    )
    renderNotice('bottom')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss desktop tools notice' })
    dismiss.focus()
    fireEvent.click(dismiss)
    expect(screen.getByRole('button', { name: 'Previous control' })).toHaveFocus()
  })
})
