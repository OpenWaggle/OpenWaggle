import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionResource } }))
vi.mock('@/features/extensions', () => ({
  ExtensionDialogSurface: () => null,
  invokeBoundExtension: vi.fn(),
}))

describe('Extension Session Summary resources', () => {
  beforeEach(() => {
    getSessionResource.mockReset().mockResolvedValue(null)
    useUIStore.setState({ resourceViewer: null })
  })

  it('falls back to a valid action when a malformed row names a missing resource', async () => {
    const openSidePanel = vi.fn()
    const summary = summaryEntry()
    if (!summary.sessionSummary) throw new Error('Expected a Session Summary fixture')
    const malformedSummary = {
      ...summary,
      sessionSummary: {
        ...summary.sessionSummary,
        rows: [
          {
            id: 'mixed-target',
            label: 'Open fallback',
            resourceId: 'missing-resource',
            action: {
              family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
              contributionId: 'details-panel',
            },
          },
        ],
      },
    } satisfies ExtensionContributionRegistryEntry
    const panel = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS, 'details-panel'),
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/panel.js',
    } satisfies ExtensionContributionRegistryEntry
    render(
      <ExtensionSessionSummarySections
        registry={registry([malformedSummary, panel])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
        onOpenSidePanel={openSidePanel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open fallback' }))
    await waitFor(() =>
      expect(openSidePanel).toHaveBeenCalledWith({
        extensionId: 'summary-extension',
        sidePanelId: 'details-panel',
        packagePath: panel.packagePath,
        contentHash: panel.contentHash,
      }),
    )
  })

  it('opens non-image extension resources in the Session Resource Browser', () => {
    const onOpenResources = vi.fn()
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry()])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[sessionResource('file')]}
        onOpenResources={onOpenResources}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(onOpenResources).toHaveBeenCalledWith({
      view: 'outputs',
      resourceId: 'resource-one',
    })
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('opens unavailable extension images in resources instead of an empty viewer', () => {
    const onOpenResources = vi.fn()
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry()])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[{ ...sessionResource('image'), available: false }]}
        onOpenResources={onOpenResources}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(onOpenResources).toHaveBeenCalledWith({
      view: 'outputs',
      resourceId: 'resource-one',
    })
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('never activates a resource that belongs to another Session', async () => {
    const onOpenResources = vi.fn()
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry()])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[sessionResource('image', 'session-two')]}
        onOpenResources={onOpenResources}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(getSessionResource).toHaveBeenCalledWith('session-one', 'resource-one', 'all'),
    )
    expect(onOpenResources).not.toHaveBeenCalled()
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('rejects actions from another package or Session', () => {
    const openSidePanel = vi.fn()
    const foreignPanel = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS, 'details-panel'),
      extensionId: 'foreign-extension',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/panel.js',
    } satisfies ExtensionContributionRegistryEntry
    const otherSessionPanel = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS, 'details-panel'),
      sessionId: 'session-two',
      target: { sessionIds: ['session-two'] },
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/panel.js',
    } satisfies ExtensionContributionRegistryEntry
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry(), foreignPanel, otherSessionPanel])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
        onOpenSidePanel={openSidePanel}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open details' })).toBeNull()
    expect(openSidePanel).not.toHaveBeenCalled()
  })
})
