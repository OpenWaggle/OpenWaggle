import type { AgentDefinitionCatalogItem } from '@shared/types/agent-definition'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manageAgentDefinitionsMock, showConfirmMock } = vi.hoisted(() => ({
  manageAgentDefinitionsMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageAgentDefinitions: manageAgentDefinitionsMock,
    showConfirm: showConfirmMock,
  },
}))

import { usePreferencesStore } from '@/features/settings/state'
import { AgentDefinitionsCard } from '../sections/AgentDefinitionsCard'

const PROJECT = '/project'
const OTHER_PROJECT = '/other-project'
const IMPORTED_REVIEWER: AgentDefinitionCatalogItem = {
  name: 'reviewer',
  description: 'Reviews a change.',
  scope: 'project',
  sourcePath: '/project/.openwaggle/agents/reviewer.md',
  definition: {
    schemaVersion: 1,
    name: 'reviewer',
    description: 'Reviews a change.',
    instructions: 'Review the requested change.',
    import: {
      sourceTool: 'codex',
      sourcePath: '/imports/reviewer.md',
      sourceDigest: 'c'.repeat(64),
      importerVersion: 1,
      baselineDigest: 'd'.repeat(64),
      importedAt: 1,
    },
  },
}

function setProject(projectPath: string) {
  const initial = usePreferencesStore.getInitialState()
  usePreferencesStore.setState({
    ...initial,
    settings: { ...initial.settings, projectPath },
  })
}

describe('AgentDefinitionsCard refresh lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setProject(PROJECT)
  })

  it('cancels a pending refresh when the selected project changes', async () => {
    const deferred = Promise.withResolvers<{
      operation: 'refresh-plan'
      plan: {
        status: 'conflict'
        sourceDigest: string
        diagnostics: readonly string[]
      }
    }>()
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation === 'list') {
        return {
          operation: 'list',
          items: command.projectPath === PROJECT ? [IMPORTED_REVIEWER] : [],
        }
      }
      if (command.operation === 'refresh-plan') return deferred.promise
      return { operation: command.operation }
    })
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh reviewer' }))
    await waitFor(() =>
      expect(manageAgentDefinitionsMock).toHaveBeenCalledWith({
        operation: 'refresh-plan',
        projectPath: PROJECT,
        name: 'reviewer',
      }),
    )
    act(() => setProject(OTHER_PROJECT))
    await screen.findByText(
      'No definitions yet. The normal default Agent remains available without one.',
    )
    await act(async () => {
      deferred.resolve({
        operation: 'refresh-plan',
        plan: { status: 'conflict', sourceDigest: 'e'.repeat(64), diagnostics: [] },
      })
      await deferred.promise
    })

    expect(showConfirmMock).not.toHaveBeenCalled()
    expect(manageAgentDefinitionsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'refresh-apply' }),
    )
  })

  it('cancels a pending deletion confirmation when the selected project changes', async () => {
    const deferred = Promise.withResolvers<boolean>()
    showConfirmMock.mockReturnValue(deferred.promise)
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation !== 'list') return { operation: command.operation }
      return {
        operation: 'list',
        items: command.projectPath === PROJECT ? [IMPORTED_REVIEWER] : [],
      }
    })
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete reviewer' }))
    await waitFor(() => expect(showConfirmMock).toHaveBeenCalledOnce())
    act(() => setProject(OTHER_PROJECT))
    await act(async () => {
      deferred.resolve(true)
      await deferred.promise
    })

    expect(manageAgentDefinitionsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'delete' }),
    )
  })
})
