import type { VcsStatus } from '@shared/types/git'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererQueryClient } from '@/queries/query-client'
import type { ChangeRequestOpener } from '../ChangeRequestLinkRow'
import { EnvironmentSummarySection } from '../SessionSummarySections'

const configureSourceControl = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { configureSourceControl } }))

const OPENER: ChangeRequestOpener = {
  destination: 'inspector',
  openInInspector: vi.fn(),
  openOnWebsite: vi.fn(),
}

const UNKNOWN_HOST = fromPartial<VcsStatus>({
  isRepo: true,
  refName: 'feature',
  sourceControlProvider: null,
  sourceControlAttention: { kind: 'choose-provider', host: 'git.corp.example' },
  sourceControlRepositoryUrl: null,
  changeRequestAttention: null,
  changeRequest: null,
})

function section(vcsStatus: VcsStatus) {
  return (
    <EnvironmentSummarySection
      input={{
        expanded: true,
        environmentMode: 'local',
        workingPath: null,
        gitStatus: null,
        vcsStatus,
        remoteVcsState: 'loaded',
        localVcsState: 'loaded',
        branches: [],
        branchBusy: false,
        branchError: null,
        onExpandedChange: vi.fn(),
        onOpenDiff: vi.fn(),
        onCreateChangeRequest: vi.fn(),
        changeRequestOpener: OPENER,
        sourceControlTerminal: null,
        onToggleTerminal: vi.fn(),
        onRefreshBranches: vi.fn(),
        onRefreshVcsStatus: vi.fn(),
        onRecheckSourceControl: vi.fn(async () => undefined),
        onSelectBranch: vi.fn().mockResolvedValue(true),
        onCreateBranch: vi.fn().mockResolvedValue(true),
        quickAction: { kind: 'show_hint', label: 'Commit or push', disabled: true, hint: 'n/a' },
        onQuickAction: vi.fn(),
      }}
    />
  )
}

/** Renders with one stable provider so a rerender updates the tree instead of remounting it. */
function renderStable(ui: ReactNode) {
  const client = createRendererQueryClient()
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    rerender: (next: ReactNode) =>
      view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

async function chooseThenResolve(choice: string, resolved: VcsStatus) {
  const { rerender } = renderStable(section(UNKNOWN_HOST))
  const button = screen.getByRole('button', { name: choice })
  button.focus()
  fireEvent.click(button)
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Change request setup' })).toHaveFocus(),
  )
  rerender(section(resolved))
}

describe('Session Summary focus after a source-control fix', () => {
  beforeEach(() => {
    configureSourceControl.mockReset().mockResolvedValue({ ok: true })
  })

  it("moves focus to the row's new primary action when the notice clears", async () => {
    await chooseThenResolve(
      'GitHub',
      fromPartial<VcsStatus>({
        ...UNKNOWN_HOST,
        sourceControlProvider: { id: 'github', host: 'git.corp.example' },
        sourceControlAttention: null,
      }),
    )

    expect(screen.getByRole('button', { name: 'Create PR' })).toHaveFocus()
  })

  it('moves focus to the section heading when the row goes away', async () => {
    await chooseThenResolve(
      'Neither',
      fromPartial<VcsStatus>({ ...UNKNOWN_HOST, sourceControlAttention: null }),
    )

    expect(screen.getByRole('button', { name: 'Environment' })).toHaveFocus()
  })

  it('leaves focus alone when the user had moved elsewhere', async () => {
    const { rerender } = renderStable(
      <>
        {section(UNKNOWN_HOST)}
        <input aria-label="Elsewhere" />
      </>,
    )
    const elsewhere = screen.getByRole('textbox', { name: 'Elsewhere' })
    screen.getByRole('button', { name: 'GitHub' }).focus()
    elsewhere.focus()

    rerender(
      <>
        {section(fromPartial<VcsStatus>({ ...UNKNOWN_HOST, sourceControlAttention: null }))}
        <input aria-label="Elsewhere" />
      </>,
    )

    expect(elsewhere).toHaveFocus()
  })
})
