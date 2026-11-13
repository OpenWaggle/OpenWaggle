import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserEngineStore } from '../../state/browser-engine-store'
import { BrowserEngineStatusOverlay } from '../BrowserEngineStatusOverlay'

const api = vi.hoisted(() => ({
  ensureBrowserEngine: vi.fn<() => Promise<BrowserEngineStatus>>(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

const MEGABYTE = 1024 * 1024

function show(status: BrowserEngineStatus) {
  act(() => useBrowserEngineStore.setState({ status }))
}

describe('BrowserEngineStatusOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBrowserEngineStore.setState({ status: { type: 'idle' } })
  })

  it('shows the download progress, then the install', () => {
    render(<BrowserEngineStatusOverlay />)
    show({ type: 'downloading', receivedBytes: 81 * MEGABYTE, totalBytes: 325 * MEGABYTE })

    expect(screen.getByText('Downloading the browser engine')).toBeTruthy()
    const progress = screen.getByRole('progressbar', { name: 'Browser engine download' })
    expect(progress.getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByText('81 of 325 MB')).toBeTruthy()

    show({ type: 'installing' })
    expect(screen.getByText('Installing the browser engine')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it.each<[BrowserEngineStatus['type'], BrowserEngineStatus]>([
    ['idle', { type: 'idle' }],
    ['checking', { type: 'checking' }],
    ['ready', { type: 'ready' }],
  ])('covers nothing while the engine is %s', (_type, status) => {
    const { container } = render(<BrowserEngineStatusOverlay />)
    show(status)
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['offline', 'Check your connection and try again.', null],
    ['http', 'The download server did not answer. Try again later.', 'Answered 503'],
    ['integrity', 'The download was incomplete or damaged. Try again.', 'Answered 503'],
  ] as const)('explains a failed %s install and retries it', async (reason, hint, detail) => {
    api.ensureBrowserEngine.mockResolvedValueOnce({ type: 'ready' })
    const { container } = render(<BrowserEngineStatusOverlay />)
    show({ type: 'failed', reason, message: 'Answered 503' })

    expect(screen.getByText('The browser engine could not be installed')).toBeTruthy()
    expect(screen.getByText(hint)).toBeTruthy()
    expect(screen.queryByText('Answered 503')?.textContent ?? null).toBe(detail)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.ensureBrowserEngine).toHaveBeenCalledOnce()
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
