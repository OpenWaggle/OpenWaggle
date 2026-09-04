import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
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

describe('ExtensionSessionSummarySections', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.setState({ resourceViewer: null })
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

  it('never activates a resource that belongs to another Session', () => {
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

    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    fireEvent.click(screen.getByText('Preview'))
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
