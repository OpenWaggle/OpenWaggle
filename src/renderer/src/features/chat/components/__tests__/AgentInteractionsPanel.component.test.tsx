import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_INTERACTION_RESPONSE_ACTION_ID } from '@/features/extensions'
import { AgentInteractionsPanel } from '../AgentInteractionsPanel'

const projectPath = '/test/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function registryWithInteractionRenderer(kind: string): ExtensionContributionRegistryView {
  const entry = {
    extensionId: 'github-fixture',
    extensionName: 'GitHub Fixture',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath,
    },
    packagePath: `${projectPath}/.openwaggle/extensions/github-fixture`,
    manifestPath: `${projectPath}/.openwaggle/extensions/github-fixture/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [projectPath],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    contributionId: 'github.interaction',
    title: 'GitHub interaction',
    label: 'GitHub interaction',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/interaction.js',
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

  return { projectPaths: [projectPath], entries: [entry] }
}

function extensionFrame() {
  const frame = screen.getByTitle('Extension module: GitHub interaction')
  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error('Expected extension interaction iframe.')
  }
  return frame
}

function extensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) {
    throw new Error('Expected extension interaction iframe window.')
  }
  return frameWindow
}

function stableExtensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = extensionFrameWindow(frame)
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: frameWindow,
  })
  return frameWindow
}

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension interaction iframe id.')
  }
  return frameId
}

function dispatchSurfaceAction(frame: HTMLIFrameElement, actionId: string, payload: unknown) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'surface-action',
        actionId,
        payload,
      },
    }),
  )
}

describe('AgentInteractionsPanel', () => {
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

  it('submits pending Pi confirm interactions from the fallback panel', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
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

    render(<AgentInteractionsPanel interactions={[interaction]} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: true })
  })

  it('shows matching extension interaction renderer without blocking fallback controls', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
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
        extensionRegistry={registryWithInteractionRenderer('confirm')}
        extensionProjectPaths={[projectPath]}
        onRespond={onRespond}
      />,
    )

    expect(screen.getByTitle('Extension module: GitHub interaction')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: true })
  })

  it('submits standard interaction responses from matching extension renderers', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
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
        extensionRegistry={registryWithInteractionRenderer('confirm')}
        extensionProjectPaths={[projectPath]}
        onRespond={onRespond}
      />,
    )

    const frame = extensionFrame()
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })

    dispatchSurfaceAction(frame, CUSTOM_INTERACTION_RESPONSE_ACTION_ID, {
      kind: 'confirm',
      accepted: false,
    })

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: false })
  })

  it('shows an explicit failure for custom interactions without a desktop renderer', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      interactionId: 'custom-interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'custom',
      customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
      source: 'pi-ui',
      createdAt: 1,
      renderer: { kind: 'pi-tui-custom', supported: false },
    } as const

    render(<AgentInteractionsPanel interactions={[interaction]} onRespond={onRespond} />)

    expect(
      screen.getByText(
        `Custom interaction · ${OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Custom desktop interaction renderer unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/does not execute Pi TUI custom components inside Electron/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reject interaction' }))

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'custom', value: null })
  })

  it('submits custom interaction responses from matching extension renderers', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      interactionId: 'custom-interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'custom',
      customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
      source: 'pi-ui',
      createdAt: 1,
      renderer: { kind: 'pi-tui-custom', supported: false },
    } as const

    render(
      <AgentInteractionsPanel
        interactions={[interaction]}
        extensionRegistry={registryWithInteractionRenderer(
          OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
        )}
        extensionProjectPaths={[projectPath]}
        onRespond={onRespond}
      />,
    )

    const frame = extensionFrame()
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })

    dispatchSurfaceAction(frame, CUSTOM_INTERACTION_RESPONSE_ACTION_ID, {
      approved: true,
      issueNumber: 113,
    })

    expect(onRespond).toHaveBeenCalledWith(interaction, {
      kind: 'custom',
      value: { approved: true, issueNumber: 113 },
    })
    expect(
      screen.queryByText('Custom desktop interaction renderer unavailable'),
    ).not.toBeInTheDocument()
  })
})
