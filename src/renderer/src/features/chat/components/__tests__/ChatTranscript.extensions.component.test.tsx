import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16
const PROJECT_PATH = '/repo'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn((input: { readonly frameId: string }) =>
    Promise.resolve({
      frameUrl: `${EXTENSION_FRAME_URL_PREFIX}${encodeURIComponent(input.frameId)}/index.html`,
      registrationId: `registration-${input.frameId}`,
    }),
  ),
  unregisterExtensionFrame: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => <div>{row.type}</div>,
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/shared/lib/cn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function createTextMessage(id: string, role: UIMessage['role'], content: string): UIMessage {
  return { id, role, parts: [{ type: 'text', content }] }
}

function transcriptRendererRegistry(): ExtensionContributionRegistryView {
  const entry = {
    extensionId: 'transcript-extension',
    extensionName: 'Transcript Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: `${PROJECT_PATH}/.openwaggle/extensions/transcript-extension`,
    manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/transcript-extension/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
    contributionId: 'transcript-extension.card',
    title: 'Transcript Extension Card',
    label: 'Transcript Extension Card',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/transcript.js',
    matches: {},
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

function createSection(): ChatTranscriptSectionState {
  const defaultMessage = createTextMessage('msg-1', 'user', 'hello')
  return {
    messages: [defaultMessage],
    isLoading: false,
    projectPath: PROJECT_PATH,
    recentProjects: [],
    activeSessionId: SessionId('session-1'),
    chatRows: [{ type: 'message', message: defaultMessage }],
    extensionRegistry: transcriptRendererRegistry(),
    extensionProjectPaths: [PROJECT_PATH],
    lastUserMessageId: 'msg-1',
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
  }
}

describe('ChatTranscript extension surfaces', () => {
  beforeEach(() => {
    apiMock.registerExtensionFrame.mockClear()
    apiMock.unregisterExtensionFrame.mockClear()
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), REQUEST_ANIMATION_FRAME_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('mounts transcript renderer contributions in the production transcript surface', async () => {
    render(<ChatTranscript section={createSection()} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(screen.getByText('Transcript Extension Card')).toBeInTheDocument()
    expect(screen.queryByText('Transcript renderer')).not.toBeInTheDocument()
    expect(screen.queryByText('transcriptRenderers')).not.toBeInTheDocument()

    const frame = screen.getByTitle('Extension module: Transcript Extension Card')
    expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
  })
})
