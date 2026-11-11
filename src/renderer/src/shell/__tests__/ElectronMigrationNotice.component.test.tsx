import type { ElectronMigrationNotice as Notice } from '@shared/types/electron-migration'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ElectronMigrationNotice } from '../ElectronMigrationNotice'

const mocks = vi.hoisted(() => ({
  get: vi.fn<() => Promise<Notice | null>>(),
  proceed: vi.fn<() => Promise<Notice | null>>(),
  skip: vi.fn<() => Promise<Notice | null>>(),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getElectronMigrationNotice: mocks.get,
    continueElectronSecretsMigration: mocks.proceed,
    skipElectronSecretsMigration: mocks.skip,
  },
}))

const CONSENT: Notice = { secrets: 'needs-consent', unrecoverable: [], error: null, busy: false }

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(null)
  mocks.proceed.mockReset().mockResolvedValue(null)
  mocks.skip.mockReset().mockResolvedValue(null)
})

describe('Electron migration notice', () => {
  it('renders nothing when nothing needs the user', async () => {
    const { container } = renderWithQueryClient(<ElectronMigrationNotice placement="top" />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the keychain prompt before anything reads the keychain', async () => {
    mocks.get.mockResolvedValue(CONSENT)
    renderWithQueryClient(<ElectronMigrationNotice placement="top" />)
    expect(await screen.findByText(/macOS will ask once; choose Always Allow/u)).toBeInTheDocument()
    expect(mocks.proceed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mocks.proceed).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull())
  })

  it('offers Try again with the reason when the keychain did not answer', async () => {
    mocks.get.mockResolvedValue({ ...CONSENT, secrets: 'blocked', error: 'timed out' })
    mocks.proceed.mockResolvedValue({ ...CONSENT, secrets: 'blocked', error: 'timed out again' })
    renderWithQueryClient(<ElectronMigrationNotice placement="bottom" />)
    expect(await screen.findByText('timed out')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('timed out again')).toBeInTheDocument()
  })

  it('names the secrets to enter again and goes away once dismissed', async () => {
    mocks.get.mockResolvedValue({ ...CONSENT, secrets: 'unrecoverable', unrecoverable: ['A', 'B'] })
    renderWithQueryClient(<ElectronMigrationNotice placement="top" />)
    expect(
      await screen.findByText(/previous version: A, B\. Enter them again\./u),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull())
  })

  it('does not start a second request while one runs', async () => {
    mocks.get.mockResolvedValue({ ...CONSENT, busy: true })
    renderWithQueryClient(<ElectronMigrationNotice placement="top" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: "Skip, I'll enter them again" }))
    expect(mocks.proceed).not.toHaveBeenCalled()
    expect(mocks.skip).not.toHaveBeenCalled()
  })
})
