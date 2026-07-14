import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { AgentTransportInteractionRequestEvent } from '@shared/types/stream'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentInteractionsPanel } from '../AgentInteractionsPanel'
import { InteractionEventRow } from '../AgentLoopInteractionEventRow'
import { ChatComposerExtensionDialogs } from '../ChatComposerExtensionDialogs'

const PROJECT_PATH = '/test/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function pendingConfirmInteraction(): AgentLoopInteraction {
  return {
    interactionId: 'interaction-1',
    sessionId: SessionId('session-1'),
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Approve action?',
    message: 'The extension wants to proceed.',
  }
}

function interactionRequestEvent(
  interaction: AgentLoopInteraction,
): AgentTransportInteractionRequestEvent {
  return {
    type: 'agent_interaction_request',
    timestamp: 1,
    interaction,
  }
}

function extensionEntry(input: {
  readonly family: ExtensionContributionRegistryEntry['family']
  readonly contributionId: string
  readonly title: string
  readonly entryPath: string
}): ExtensionContributionRegistryEntry {
  return {
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
    family: input.family,
    contributionId: input.contributionId,
    title: input.title,
    label: input.title,
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: input.entryPath,
    matches: { interactionKinds: ['confirm'] },
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

function multiSurfaceInteractionRegistry(): ExtensionContributionRegistryView {
  return {
    projectPaths: [PROJECT_PATH],
    entries: [
      extensionEntry({
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
        contributionId: 'github.interaction',
        title: 'GitHub interaction renderer',
        entryPath: 'dist/interaction.js',
      }),
      extensionEntry({
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
        contributionId: 'github.dialog',
        title: 'GitHub approval dialog',
        entryPath: 'dist/dialog.js',
      }),
      extensionEntry({
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
        contributionId: 'github.side-panel',
        title: 'GitHub approval side panel',
        entryPath: 'dist/side-panel.js',
      }),
      extensionEntry({
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
        contributionId: 'github.status',
        title: 'GitHub status widget',
        entryPath: 'dist/status.js',
      }),
    ],
  }
}

function AgentLoopExtensionSurfaceHarness({
  interaction,
  registry,
  onRespond,
}: {
  readonly interaction: AgentLoopInteraction
  readonly registry: ExtensionContributionRegistryView
  readonly onRespond: (
    interaction: AgentLoopInteraction,
    response: AgentLoopInteractionResponse,
  ) => Promise<void>
}) {
  const extensions = { registry, projectPaths: [PROJECT_PATH] }

  return (
    <>
      <InteractionEventRow event={interactionRequestEvent(interaction)} extensions={extensions} />
      <AgentInteractionsPanel
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={registry}
        interactions={[interaction]}
        onRespond={onRespond}
      />
      <ChatComposerExtensionDialogs
        agentInteractions={[interaction]}
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={registry}
        onRespond={onRespond}
      />
    </>
  )
}

describe('agent-loop extension surfaces', () => {
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

  it('renders the same pending Pi interaction across transcript, live, status, and composer extension surfaces', async () => {
    const interaction = pendingConfirmInteraction()
    const registry = multiSurfaceInteractionRegistry()

    render(
      <AgentLoopExtensionSurfaceHarness
        interaction={interaction}
        onRespond={vi.fn().mockResolvedValue(undefined)}
        registry={registry}
      />,
    )

    expect(screen.getByText('Interaction requested')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByTitle('Extension module: GitHub interaction renderer')).toHaveLength(2)
      expect(screen.getByTitle('Extension module: GitHub status widget')).toHaveAttribute(
        'src',
        expect.stringContaining(EXTENSION_FRAME_URL_PREFIX),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))

    expect(screen.getByRole('button', { name: /github approval dialog/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /github approval side panel/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /github approval dialog/i }))

    expect(screen.getByRole('dialog', { name: 'GitHub approval dialog' })).toBeInTheDocument()
    expect(screen.getByTitle('Extension module: GitHub approval dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close extension dialog' }))
    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))
    fireEvent.click(screen.getByRole('button', { name: /github approval side panel/i }))

    expect(screen.getByLabelText('Extension side panel')).toBeInTheDocument()
    expect(screen.getByTitle('Extension module: GitHub approval side panel')).toBeInTheDocument()
  })
})
