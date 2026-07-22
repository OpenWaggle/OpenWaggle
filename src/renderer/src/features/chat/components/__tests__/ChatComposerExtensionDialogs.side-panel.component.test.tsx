import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_INTERACTION_RESPONSE_ACTION_ID } from '@/features/extensions'
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

function sidePanelEntry(kind: string): ExtensionContributionRegistryEntry {
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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributionId: 'github.approval-side-panel',
    title: 'GitHub approval side panel',
    label: 'GitHub approval side panel',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/side-panel.js',
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
  }
}

function sidePanelRegistry(kind: string): ExtensionContributionRegistryView {
  return { projectPaths: [PROJECT_PATH], entries: [sidePanelEntry(kind)] }
}

function pendingInteraction(): AgentLoopInteraction {
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

function extensionFrame() {
  const frame = screen.getByTitle('Extension module: GitHub approval side panel')
  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error('Expected extension side panel iframe.')
  }
  return frame
}

function stableExtensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) {
    throw new Error('Expected extension side panel iframe window.')
  }
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: frameWindow,
  })
  return frameWindow
}

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension side panel iframe id.')
  }
  return frameId
}

function dispatchSurfaceAction(frame: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: stableExtensionFrameWindow(frame),
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'surface-action',
        actionId: CUSTOM_INTERACTION_RESPONSE_ACTION_ID,
        payload: { kind: 'confirm', accepted: true },
      },
    }),
  )
}

describe('ChatComposerExtensionDialogs side-panel launchers', () => {
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

  it('opens side-panel launchers and submits typed interaction responses', async () => {
    const interaction = pendingInteraction()
    const onRespond = vi.fn().mockResolvedValue(undefined)

    render(
      <ChatComposerExtensionDialogs
        agentInteractions={[interaction]}
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={sidePanelRegistry('confirm')}
        onRespond={onRespond}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))
    fireEvent.click(screen.getByRole('button', { name: /github approval side panel/i }))

    expect(screen.getByLabelText('Extension side panel')).toBeInTheDocument()
    const frame = extensionFrame()
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })

    dispatchSurfaceAction(frame)

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: true })
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('Extension side panel')).not.toBeInTheDocument()
    })
  })
})
