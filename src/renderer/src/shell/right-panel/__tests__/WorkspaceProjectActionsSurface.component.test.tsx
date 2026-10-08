import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { terminalOwnerContext } from '@/features/terminal'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({ manage: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))

import { WorkspaceProjectActionsSurface } from '../WorkspaceProjectActionsSurface'

const PROJECT_A = '/projects/a'
const PROJECT_B = '/projects/b'

function action(id: string, name: string): ActionDefinition {
  return {
    id,
    name,
    icon: 'play',
    invocation: { type: 'command', command: `echo ${id}`, directory: '.' },
    kind: 'task',
    allowConcurrent: false,
    autoOpenPreview: false,
  }
}

const CATALOGS: Readonly<Record<string, ActionCatalog>> = {
  [PROJECT_A]: {
    revision: 'a-1',
    actions: [{ source: 'local', definition: action('only-a', 'Only in A') }],
    profiles: [],
    preparation: [],
  },
  [PROJECT_B]: {
    revision: 'b-1',
    actions: [{ source: 'local', definition: action('only-b', 'Only in B') }],
    profiles: [],
    preparation: [],
  },
}

function session(id: string, projectPath: string) {
  return fromPartial<SessionDetail>({ id: SessionId(id), projectPath })
}

const initialChat = useChatStore.getState()
const initialPreferences = usePreferencesStore.getState()

function setPreferredProject(projectPath: string | null) {
  usePreferencesStore.setState({
    settings: { ...usePreferencesStore.getState().settings, projectPath },
  })
}

function renderSurface() {
  return renderWithQueryClient(
    <WorkspaceProjectActionsSurface owner={terminalOwnerContext(null, PROJECT_B)} />,
  )
}

beforeEach(() => {
  mocks.manage.mockReset()
  mocks.manage.mockImplementation(
    async (request: {
      readonly scope: { readonly projectPath: string }
      readonly operation: { readonly type: string }
    }) => {
      if (request.operation.type === 'runs') return { type: 'runs', runs: [] }
      const catalog = CATALOGS[request.scope.projectPath]
      if (!catalog) throw new Error(`Unknown project ${request.scope.projectPath}`)
      return { type: 'catalog', catalog }
    },
  )
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  usePreferencesStore.setState(initialPreferences, true)
})

describe('WorkspaceProjectActionsSurface project containment', () => {
  it("lists the open Session's project actions while the project preference still names another project", async () => {
    // Selecting a Session updates the global project preference through the Host afterwards; the
    // write can lag or fail, so for a while the preference still names the previous project.
    setPreferredProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: SessionId('session-b'),
      activeSession: session('session-b', PROJECT_B),
      draftSession: null,
    })

    renderSurface()

    expect(await screen.findByText('Only in B')).toBeInTheDocument()
    expect(screen.queryByText('Only in A')).not.toBeInTheDocument()
    expect(
      mocks.manage.mock.calls.every(([request]) => request.scope.projectPath === PROJECT_B),
    ).toBe(true)
  })

  it("lists a draft Session's chosen project, not the stale preference", async () => {
    setPreferredProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: null,
      activeSession: null,
      draftSession: { projectPath: PROJECT_B },
    })

    renderSurface()

    expect(await screen.findByText('Only in B')).toBeInTheDocument()
    expect(screen.queryByText('Only in A')).not.toBeInTheDocument()
  })

  it('shows no project actions while the selected Session is still loading', async () => {
    setPreferredProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: SessionId('session-b'),
      activeSession: null,
      draftSession: null,
    })

    renderSurface()

    expect(await screen.findByText('Open a project first to run its actions.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.manage).not.toHaveBeenCalled())
  })
})
