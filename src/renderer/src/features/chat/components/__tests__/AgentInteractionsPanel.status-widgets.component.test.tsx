import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentInteractionsPanel } from '../AgentInteractionsPanel'

const PROJECT_PATH = '/test/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function statusWidgetRegistry(kind: string): ExtensionContributionRegistryView {
  const entry = {
    extensionId: 'github-fixture',
    extensionName: 'GitHub Fixture',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: `${PROJECT_PATH}/.openwaggle/extensions/github-fixture`,
    manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/github-fixture/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
    contributionId: 'github.status',
    title: 'GitHub status widget',
    label: 'GitHub status widget',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/status.js',
    matches: { interactionKinds: [kind] },
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  } satisfies ExtensionContributionRegistryEntry

  return { projectPaths: [PROJECT_PATH], entries: [entry] }
}

describe('AgentInteractionsPanel status widgets', () => {
  beforeEach(() => {
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: `${EXTENSION_FRAME_URL_PREFIX}${encodeURIComponent(input.frameId)}/index.html`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterExtensionFrame.mockResolvedValue(undefined)
  })

  it('mounts status widgets that target the same pending Pi interaction', async () => {
    const interaction = {
      interactionId: 'interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: 1,
      title: 'Approve action?',
      message: 'The extension wants to proceed.',
    } as const

    render(
      <AgentInteractionsPanel
        interactions={[interaction]}
        extensionRegistry={statusWidgetRegistry('confirm')}
        extensionProjectPaths={[PROJECT_PATH]}
        onRespond={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const frame = screen.getByTitle('Extension module: GitHub status widget')
    expect(screen.getByLabelText('Extension status widgets')).toBeInTheDocument()
    expect(screen.getByText('GitHub status widget')).toBeInTheDocument()
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })
  })
})
