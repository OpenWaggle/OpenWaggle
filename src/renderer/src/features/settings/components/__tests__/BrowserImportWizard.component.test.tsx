import type {
  BrowserImportSource,
  BrowserImportTarget,
  GuidedBrowserImportResult,
} from '@shared/types/browser-import'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BrowserImportWizard } from '../sections/BrowserImportWizard'

const readySource: BrowserImportSource = {
  id: 'chrome',
  name: 'Chrome',
  profiles: [
    { directory: 'Default', name: 'Personal', cookieCount: 12 },
    { directory: 'Profile 1', name: 'Work', cookieCount: 4 },
  ],
}
const targets = [
  { id: 'default', name: 'Default' },
  { id: 'existing-work', name: 'Existing work' },
]

function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function renderWizard(
  options: {
    readonly source?: BrowserImportSource
    readonly canCreateProfile?: boolean
    readonly onImport?: (input: {
      readonly sourceProfileDirectory: string
      readonly target: BrowserImportTarget
    }) => Promise<GuidedBrowserImportResult>
    readonly onRefreshSource?: () => Promise<BrowserImportSource | undefined>
    readonly onOpenFullDiskAccessSettings?: () => Promise<boolean>
  } = {},
) {
  const onClose = vi.fn()
  const onImport =
    options.onImport ??
    vi.fn(
      async (): Promise<GuidedBrowserImportResult> => ({
        ok: true,
        result: { imported: 1, skipped: 0, skippedDomains: [] },
        targetName: 'Chrome',
        createdProfile: null,
      }),
    )
  const onRefreshSource = options.onRefreshSource ?? vi.fn(async () => readySource)
  const onOpenFullDiskAccessSettings =
    options.onOpenFullDiskAccessSettings ?? vi.fn(async () => true)
  render(
    <BrowserImportWizard
      source={options.source ?? readySource}
      targetProfiles={targets}
      canCreateProfile={options.canCreateProfile ?? true}
      onImport={onImport}
      onRefreshSource={onRefreshSource}
      onOpenFullDiskAccessSettings={onOpenFullDiskAccessSettings}
      onClose={onClose}
    />,
  )
  return { onClose, onImport, onOpenFullDiskAccessSettings, onRefreshSource }
}

describe('BrowserImportWizard', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
  })

  it('prevents duplicate writes and Escape dismissal while importing', async () => {
    const first = deferred<GuidedBrowserImportResult>()
    const onImport = vi.fn<
      (input: {
        readonly sourceProfileDirectory: string
        readonly target: BrowserImportTarget
      }) => Promise<GuidedBrowserImportResult>
    >(() => first.promise)
    const { onClose } = renderWizard({ onImport })
    const importButton = screen.getByRole('button', { name: 'Import cookies' })

    fireEvent.click(importButton)
    fireEvent.click(importButton)

    expect(onImport).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const cancel = new Event('cancel', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    first.resolve({
      ok: true,
      result: { imported: 2, skipped: 0, skippedDomains: [] },
      targetName: 'Chrome',
      createdProfile: { id: 'created', name: 'Chrome', kind: 'persistent' },
    })
    expect(await screen.findByText('Imported 2 cookies')).toBeInTheDocument()
    expect(screen.getByText('Created the isolated profile Chrome.')).toBeInTheDocument()
  })

  it('uses the same new destination id after a recoverable retry', async () => {
    const onImport = vi
      .fn<
        (input: {
          readonly sourceProfileDirectory: string
          readonly target: BrowserImportTarget
        }) => Promise<GuidedBrowserImportResult>
      >()
      .mockResolvedValueOnce({
        ok: false,
        reason: 'needs-keychain-approval',
        message: 'Approve access.',
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { imported: 1, skipped: 0, skippedDomains: [] },
        targetName: 'Chrome',
        createdProfile: { id: 'created', name: 'Chrome', kind: 'persistent' },
      })
    renderWizard({ onImport })

    fireEvent.click(screen.getByRole('button', { name: 'Import cookies' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByText('Imported 1 cookie')

    const firstTarget = onImport.mock.calls[0]?.[0].target
    const secondTarget = onImport.mock.calls[1]?.[0].target
    expect(firstTarget).toMatchObject({ kind: 'new' })
    expect(secondTarget).toEqual(firstTarget)
  })

  it('rechecks a running browser and preserves the selected source profile', async () => {
    const source = { ...readySource, unavailable: 'browser-running' as const }
    const onRefreshSource = vi.fn(async () => readySource)
    const { onImport } = renderWizard({ source, onRefreshSource })

    expect(screen.getByText('Quit Chrome to import')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I have quit it' }))

    expect(await screen.findByText('Import from Chrome')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Work, 4 cookies' }))
    fireEvent.click(screen.getByRole('button', { name: 'Existing work, Existing profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import cookies' }))

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith({
        sourceProfileDirectory: 'Profile 1',
        target: { kind: 'existing', profileId: 'existing-work' },
      })
    })
  })

  it('guides Full Disk Access, including the manual fallback and denied recheck', async () => {
    const source = { ...readySource, unavailable: 'needs-full-disk-access' as const }
    const onOpenFullDiskAccessSettings = vi.fn(async () => false)
    const onRefreshSource = vi.fn(async () => source)
    renderWizard({ source, onOpenFullDiskAccessSettings, onRefreshSource })

    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(
      await screen.findByText('Open Privacy & Security, then Full Disk Access, manually.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I have turned it on' }))

    expect(await screen.findByText(/Full Disk Access is still required/)).toBeInTheDocument()
    expect(onOpenFullDiskAccessSettings).toHaveBeenCalledOnce()
    expect(onRefreshSource).toHaveBeenCalledOnce()
  })

  it('offers selection recovery when the profile cap changes during import', async () => {
    renderWizard({
      onImport: vi.fn(
        async (): Promise<GuidedBrowserImportResult> => ({
          ok: false,
          reason: 'profile-limit-reached',
          message: 'Limit reached.',
        }),
      ),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Import cookies' }))
    expect(await screen.findByText(/profile limit was reached/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose destination' }))

    expect(screen.getByText('Import from Chrome')).toBeInTheDocument()
  })
})
