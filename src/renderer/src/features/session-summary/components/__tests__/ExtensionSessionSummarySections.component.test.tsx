import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import {
  baseEntry,
  PROJECT_PATH,
  registry,
  sessionResource,
  summaryEntry,
} from './extension-session-summary-test-fixtures'

const getSessionResource = vi.hoisted(() => vi.fn())
const renderExtensionDialog = vi.hoisted(() => vi.fn())

interface ExtensionDialogProbeProps {
  readonly target: {
    readonly extensionId: string
    readonly dialogId: string
    readonly packagePath: string
    readonly contentHash: string
  }
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly surfacePayload?: JsonValue
  readonly onClose: () => void
}

vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionResource } }))
vi.mock('@/features/extensions', () => ({
  ExtensionDialogSurface: (props: ExtensionDialogProbeProps) => {
    renderExtensionDialog(props)
    return <input type="button" value="Close extension dialog probe" onClick={props.onClose} />
  },
  invokeBoundExtension: vi.fn(),
}))

describe('ExtensionSessionSummarySections', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.setState({ resourceViewer: null })
    getSessionResource.mockReset().mockResolvedValue(null)
    renderExtensionDialog.mockReset()
  })

  it('renders declarative rows only in their declared placement', () => {
    const view = registry([summaryEntry()])
    const rendered = render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={3}
        placement="context"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.queryByText('Build status')).toBeNull()

    rendered.rerender(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={3}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.getByText('Build status')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Workers').parentElement).toHaveTextContent('4')
  })

  it('renders a Session-targeted contribution only for its owning Session', () => {
    const targetedEntry = {
      ...summaryEntry(),
      sessionId: 'session-two',
      target: { sessionIds: ['session-two'] },
    } satisfies ExtensionContributionRegistryEntry
    const view = registry([targetedEntry])
    const rendered = render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.queryByText('Build status')).toBeNull()

    rendered.rerender(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-two"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.getByText('Build status')).toBeInTheDocument()
  })

  it('keeps resource and side-panel actions scoped to the opened session and package', () => {
    const openSidePanel = vi.fn()
    const panel = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS, 'details-panel'),
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/panel.js',
    } satisfies ExtensionContributionRegistryEntry
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry(), panel])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[sessionResource('image')]}
        onOpenResources={vi.fn()}
        onOpenSidePanel={openSidePanel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-one',
      resourceId: 'resource-one',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
    expect(openSidePanel).toHaveBeenCalledWith({
      extensionId: 'summary-extension',
      sidePanelId: 'details-panel',
      packagePath: panel.packagePath,
      contentHash: panel.contentHash,
    })
  })

  it('opens a declarative dialog with the owning Session payload and closes it', () => {
    const summary = summaryEntry()
    if (!summary.sessionSummary) throw new Error('Expected a Session Summary fixture')
    const dialog = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS, 'session-context'),
      title: 'Session context',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/session-context.js',
    } satisfies ExtensionContributionRegistryEntry
    const declarativeSummary = {
      ...summary,
      sessionSummary: {
        ...summary.sessionSummary,
        rows: [
          {
            id: 'inspect-session',
            label: 'Inspect session context',
            action: {
              family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
              contributionId: dialog.contributionId,
            },
          },
        ],
      },
    } satisfies ExtensionContributionRegistryEntry
    const view = registry([declarativeSummary, dialog])

    render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={7}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Inspect session context' }))
    expect(renderExtensionDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: {
          extensionId: dialog.extensionId,
          dialogId: dialog.contributionId,
          packagePath: dialog.packagePath,
          contentHash: dialog.contentHash,
        },
        projectPaths: [PROJECT_PATH],
        registry: expect.objectContaining({
          projectPaths: [PROJECT_PATH],
          entries: [declarativeSummary, dialog],
        }),
        surfacePayload: {
          surface: 'session-summary',
          sessionId: 'session-one',
          projectPaths: [PROJECT_PATH],
          messageCount: 7,
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close extension dialog probe' }))
    expect(screen.queryByRole('button', { name: 'Close extension dialog probe' })).toBeNull()
  })
})
