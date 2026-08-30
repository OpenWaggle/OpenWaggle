import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'

const extensionMocks = vi.hoisted(() => ({
  host: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/features/extensions', () => ({
  ExtensionContributionRuntimeHost: (props: unknown) => extensionMocks.host(props),
  resolveExtensionAgentLoopContributionEntries: (input: unknown) => extensionMocks.resolve(input),
}))

const PROJECT_PATH = '/project'

function entry(id: string): ExtensionContributionRegistryEntry {
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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
    contributionId: id,
    title: id === 'broken' ? 'Broken section' : 'Healthy section',
    label: id,
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/summary.html',
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

const REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [entry('healthy')],
}

describe('ExtensionSessionSummarySections', () => {
  beforeEach(() => {
    extensionMocks.host
      .mockReset()
      .mockImplementation((props: { readonly surfacePayload: unknown }) => (
        <output>{JSON.stringify(props.surfacePayload)}</output>
      ))
    extensionMocks.resolve.mockReset().mockReturnValue([{ entry: entry('healthy') }])
  })

  it('passes only the opened session scope to eligible extension sections', () => {
    const view = render(
      <ExtensionSessionSummarySections
        registry={REGISTRY}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={3}
      />,
    )

    expect(screen.getByText(/"sessionId":"session-one"/)).toBeInTheDocument()
    expect(screen.queryByText(/session-two/)).toBeNull()
    expect(extensionMocks.resolve).toHaveBeenCalledWith({
      registry: REGISTRY,
      target: { surface: 'transcript' },
      requestedProjectPaths: [PROJECT_PATH],
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
    })

    view.rerender(
      <ExtensionSessionSummarySections
        registry={REGISTRY}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-two"
        messageCount={1}
      />,
    )
    expect(screen.getByText(/"sessionId":"session-two"/)).toBeInTheDocument()
    expect(screen.queryByText(/session-one/)).toBeNull()
  })

  it('contains a failed extension without hiding healthy sections', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    extensionMocks.resolve.mockReturnValue([
      { entry: entry('broken') },
      { entry: entry('healthy') },
    ])
    extensionMocks.host.mockImplementation(
      (props: { readonly entry: ExtensionContributionRegistryEntry }) => {
        if (props.entry.contributionId === 'broken') throw new Error('Extension failed')
        return <output>Healthy extension content</output>
      },
    )

    render(
      <ExtensionSessionSummarySections
        registry={REGISTRY}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
      />,
    )

    expect(screen.getByText('Healthy extension content')).toBeInTheDocument()
    expect(
      screen.getByText(/Session Summary extension: Broken section panel error/),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
