import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { type Mock, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { useSessionSummaryUIStore } from '@/features/session-summary'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import type { ChatPanelSections } from '../../model'
import { ChatPanel } from '../ChatPanel'
import { createSections } from './ChatPanel.test-utils'

const mocks = vi.hoisted(() => ({
  useChatPanelSections: vi.fn<() => ChatPanelSections>(),
  listSessionResources: vi.fn<OpenWaggleApi['listSessionResources']>(),
  readSessionResource: vi.fn<OpenWaggleApi['readSessionResource']>(),
  advanceSessionResourceBackfill: vi.fn<OpenWaggleApi['advanceSessionResourceBackfill']>(),
  locateSessionResourceImage: vi.fn<OpenWaggleApi['locateSessionResourceImage']>(),
  activateSessionResourceOwner: vi.fn<OpenWaggleApi['activateSessionResourceOwner']>(),
}))

export const useChatPanelSectionsMock = mocks.useChatPanelSections
export const listSessionResources: Mock<OpenWaggleApi['listSessionResources']> =
  mocks.listSessionResources
export const readSessionResource: Mock<OpenWaggleApi['readSessionResource']> =
  mocks.readSessionResource
export const advanceSessionResourceBackfill: Mock<OpenWaggleApi['advanceSessionResourceBackfill']> =
  mocks.advanceSessionResourceBackfill
export let notifyResize = () => {}

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): ResizeObserverEntry[] {
    return []
  }
}

vi.mock('../../hooks/use-chat-panel-controller', () => ({
  useChatPanelSections: mocks.useChatPanelSections,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue({ currentBranch: 'main', branches: [] }),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
    onWaggleEvent: vi.fn(() => () => undefined),
    onWaggleTurnEvent: vi.fn(() => () => undefined),
    listSessionResources: mocks.listSessionResources,
    readSessionResource: mocks.readSessionResource,
    advanceSessionResourceBackfill: mocks.advanceSessionResourceBackfill,
    locateSessionResourceImage: mocks.locateSessionResourceImage,
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    onRunCompleted: vi.fn(() => () => undefined),
    onSessionResourcesInvalidated: vi.fn(() => () => undefined),
    activateSessionResourceOwner: mocks.activateSessionResourceOwner,
    getVcsStatus: vi.fn().mockResolvedValue(null),
    onGitWorkingTreeChanged: vi.fn(() => () => undefined),
  },
}))

export const SESSION: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Session one',
  projectPath: '/test/project',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

export function renderPanel(
  overrides: Partial<ChatPanelSections['transcript']> = {},
  composerOverrides: Partial<ChatPanelSections['composer']> = {},
): RenderResult {
  useChatPanelSectionsMock.mockReturnValue(createSections(overrides, composerOverrides))
  return render(chatPanelElement())
}

export function chatPanelElement(): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ChatPanel />
    </QueryClientProvider>
  )
}

export function toggleSessionSummaryPanel(sessionId: string) {
  useSessionSummaryUIStore.getState().togglePanel(sessionId)
}

export function setupChatPanelSessionSummaryHarness() {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  localStorage.clear()
  useSessionSummaryUIStore.setState({ panels: {} })
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: '/test/project',
      selectedModel: SupportedModelId('openai/gpt-5'),
    },
    isLoaded: true,
  })
  useProviderStore.setState({ ...useProviderStore.getInitialState(), providerModels: [] })
  useUIStore.setState({ resourceViewer: null })
  listSessionResources.mockReset().mockResolvedValue({
    resources: [],
    backfillComplete: true,
  })
  advanceSessionResourceBackfill.mockReset().mockResolvedValue({
    backfillComplete: true,
    progressed: false,
  })
  mocks.locateSessionResourceImage.mockReset().mockResolvedValue(null)
  readSessionResource.mockReset().mockResolvedValue({
    resourceId: 'active-image',
    fileName: 'active.png',
    mimeType: 'image/png',
    url: 'openwaggle-session-resource://content/active-image/view',
    downloadUrl: 'openwaggle-session-resource://content/active-image/download',
  })
}
