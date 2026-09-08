import type { GuidedBrowserImportResult } from '@shared/types/browser-import'
import { BUILT_IN_BROWSER_PROFILES } from '@shared/types/browser-profile'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guidedImportBrowserCookies: vi.fn(),
  listBrowserImportSources: vi.fn(),
  loadSettings: vi.fn(),
  openBrowserImportFullDiskAccessSettings: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    guidedImportBrowserCookies: mocks.guidedImportBrowserCookies,
    listBrowserImportSources: mocks.listBrowserImportSources,
    openBrowserImportFullDiskAccessSettings: mocks.openBrowserImportFullDiskAccessSettings,
  },
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (select: (state: { loadSettings: typeof mocks.loadSettings }) => unknown) =>
    select({ loadSettings: mocks.loadSettings }),
}))

import { BrowserCookieImportCard } from '../sections/BrowserCookieImportCard'

function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('BrowserCookieImportCard', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadSettings.mockResolvedValue(undefined)
    mocks.openBrowserImportFullDiskAccessSettings.mockResolvedValue(true)
  })

  it('omits dead sources but lets the wizard recover a running browser', async () => {
    mocks.listBrowserImportSources.mockResolvedValue([
      { id: 'safari', name: 'Safari', profiles: [], unavailable: 'not-installed' },
      {
        id: 'chrome',
        name: 'Chrome',
        profiles: [{ directory: 'Default', name: 'Personal' }],
        unavailable: 'browser-running',
      },
    ])
    render(<BrowserCookieImportCard profiles={BUILT_IN_BROWSER_PROFILES} />)

    expect(await screen.findByRole('option', { name: 'Chrome' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Safari' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Quit Chrome to import')).toBeInTheDocument()
  })

  it('uses the guided endpoint and refreshes profiles after publishing a new target', async () => {
    mocks.listBrowserImportSources.mockResolvedValue([
      {
        id: 'firefox',
        name: 'Firefox',
        profiles: [{ directory: 'Profiles/default', name: 'Default release', cookieCount: 7 }],
      },
    ])
    mocks.guidedImportBrowserCookies.mockResolvedValue({
      ok: true,
      result: { imported: 7, skipped: 0, skippedDomains: [] },
      targetName: 'Firefox',
      createdProfile: { id: 'created', name: 'Firefox', kind: 'persistent' },
    } satisfies GuidedBrowserImportResult)
    render(<BrowserCookieImportCard profiles={BUILT_IN_BROWSER_PROFILES} />)

    await screen.findByRole('option', { name: 'Firefox' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import cookies' }))

    await waitFor(() => {
      expect(mocks.guidedImportBrowserCookies).toHaveBeenCalledWith({
        sourceId: 'firefox',
        sourceProfileDirectory: 'Profiles/default',
        target: {
          kind: 'new',
          profileId: expect.stringMatching(/^profile-/u),
        },
      })
      expect(mocks.loadSettings).toHaveBeenCalledOnce()
    })
    expect(await screen.findByText('Imported 7 cookies')).toBeInTheDocument()
  })

  it('allows only one parent-level IPC import while a write is unresolved', async () => {
    const importResult = deferred<GuidedBrowserImportResult>()
    mocks.listBrowserImportSources.mockResolvedValue([
      {
        id: 'firefox',
        name: 'Firefox',
        profiles: [{ directory: 'Profiles/default', name: 'Default release' }],
      },
    ])
    mocks.guidedImportBrowserCookies.mockReturnValue(importResult.promise)
    render(<BrowserCookieImportCard profiles={BUILT_IN_BROWSER_PROFILES} />)

    await screen.findByRole('option', { name: 'Firefox' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const importButton = screen.getByRole('button', { name: 'Import cookies' })
    fireEvent.click(importButton)
    fireEvent.click(importButton)

    expect(mocks.guidedImportBrowserCookies).toHaveBeenCalledOnce()
    importResult.resolve({
      ok: true,
      result: { imported: 1, skipped: 0, skippedDomains: [] },
      targetName: 'Firefox',
      createdProfile: null,
    })
    expect(await screen.findByText('Imported 1 cookie')).toBeInTheDocument()
  })
})
