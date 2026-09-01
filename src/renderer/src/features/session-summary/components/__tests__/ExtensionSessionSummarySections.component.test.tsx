import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'

const PROJECT_PATH = '/project'

function baseEntry(
  family: ExtensionContributionRegistryEntry['family'],
  contributionId: string,
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'summary-extension',
    extensionName: 'Summary Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: `${PROJECT_PATH}/.openwaggle/extensions/summary-extension`,
    manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/summary-extension/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family,
    contributionId,
    title: contributionId,
    label: contributionId,
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  }
}

function summaryEntry(): ExtensionContributionRegistryEntry {
  return {
    ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS, 'summary'),
    title: 'Build status',
    sessionSummary: {
      placement: 'details',
      rows: [
        { id: 'status', label: 'Status', value: 'Ready' },
        { id: 'workers', label: 'Workers', count: 4 },
        { id: 'artifact', label: 'Preview', resourceId: 'resource-one' },
        {
          id: 'open-panel',
          label: 'Open details',
          action: { family: 'sidePanels', contributionId: 'details-panel' },
        },
      ],
    },
  }
}

function registry(entries: readonly ExtensionContributionRegistryEntry[]) {
  return { projectPaths: [PROJECT_PATH], entries } satisfies ExtensionContributionRegistryView
}

function sessionResource(kind: SessionResource['kind']): SessionResource {
  return {
    id: 'resource-one',
    sessionId: SessionId('session-one'),
    canonicalKey: 'file:resource-one',
    kind,
    title: 'Resource one',
    mimeType: null,
    locator: 'session-resource://resource-one',
    managed: true,
    available: true,
    isSource: false,
    isOutput: true,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ExtensionSessionSummarySections', () => {
  beforeEach(() => {
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
    expect(screen.getByText('4')).toBeInTheDocument()
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

  it('opens non-image extension resources in the session resource browser', () => {
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
    expect(onOpenResources).toHaveBeenCalledOnce()
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
    expect(onOpenResources).toHaveBeenCalledOnce()
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('does not activate an action that is not declared by the same extension package', () => {
    const openSidePanel = vi.fn()
    const foreignPanel = {
      ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS, 'details-panel'),
      extensionId: 'foreign-extension',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entryPath: 'dist/panel.js',
    } satisfies ExtensionContributionRegistryEntry
    render(
      <ExtensionSessionSummarySections
        registry={registry([summaryEntry(), foreignPanel])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[sessionResource('image')]}
        onOpenResources={vi.fn()}
        onOpenSidePanel={openSidePanel}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open details' })).toBeNull()
    expect(openSidePanel).not.toHaveBeenCalled()
  })
})
