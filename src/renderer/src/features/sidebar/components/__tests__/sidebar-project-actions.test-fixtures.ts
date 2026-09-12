import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarViewStore } from '../../state/sidebar-view-store'

export const PROJECT_PATH = '/repo/openwaggle'
export const SESSION_ID = SessionId('session-project-1')
export const ARCHIVED_SESSION_ID = SessionId('session-project-archived')

export function makeSession(): SessionSummary {
  return {
    id: SESSION_ID,
    title: 'Existing project session',
    projectPath: PROJECT_PATH,
    createdAt: 10,
    updatedAt: 20,
  }
}

export function makeArchivedSession(): SessionSummary {
  return {
    ...makeSession(),
    id: ARCHIVED_SESSION_ID,
    title: 'Archived project session',
    updatedAt: 5,
  }
}

export function resetStores(session = makeSession()) {
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: PROJECT_PATH,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [PROJECT_PATH],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions: [session],
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: SESSION_ID,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: [session],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
  })
  useUIStore.setState({
    ...useUIStore.getInitialState(),
    sidebarOpen: true,
  })
  useSidebarViewStore.setState({ sessionSortMode: 'recent', projectExpandedByPath: {} })
}
