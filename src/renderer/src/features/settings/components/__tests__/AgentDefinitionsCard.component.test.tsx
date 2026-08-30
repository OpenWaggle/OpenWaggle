import type {
  AgentDefinitionCatalogItem,
  AgentDefinitionDocument,
} from '@shared/types/agent-definition'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manageAgentDefinitionsMock, selectSourceMock, showConfirmMock } = vi.hoisted(() => ({
  manageAgentDefinitionsMock: vi.fn(),
  selectSourceMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageAgentDefinitions: manageAgentDefinitionsMock,
    selectAgentDefinitionSource: selectSourceMock,
    showConfirm: showConfirmMock,
  },
}))

import { usePreferencesStore } from '@/features/settings/state'
import { AgentDefinitionsCard } from '../sections/AgentDefinitionsCard'

const PROJECT = '/project'
const REVIEWER_DEFINITION: AgentDefinitionDocument = {
  schemaVersion: 1,
  name: 'reviewer',
  description: 'Reviews a change.',
  instructions: 'Review the requested change.',
}
const REVIEWER: AgentDefinitionCatalogItem = {
  name: 'reviewer',
  description: 'Reviews a change.',
  scope: 'project',
  sourcePath: '/project/.openwaggle/agents/reviewer.md',
  contentDigest: 'a'.repeat(64),
  definition: REVIEWER_DEFINITION,
}

const LOCKED_DOWN_REVIEWER: AgentDefinitionCatalogItem = {
  ...REVIEWER,
  name: 'locked-down-reviewer',
  sourcePath: '/project/.openwaggle/agents/locked-down-reviewer.md',
  definition: {
    ...REVIEWER_DEFINITION,
    name: 'locked-down-reviewer',
    tools: [],
    skills: [],
    mcpServers: [],
    sessionCapabilities: [],
  },
}

function setProject(projectPath = PROJECT) {
  const initial = usePreferencesStore.getInitialState()
  usePreferencesStore.setState({
    ...initial,
    settings: { ...initial.settings, projectPath },
  })
}

describe('AgentDefinitionsCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setProject()
    showConfirmMock.mockResolvedValue(true)
    selectSourceMock.mockResolvedValue('/imports/reviewer.md')
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation === 'list') return { operation: 'list', items: [REVIEWER] }
      return {
        operation: command.operation,
        name: command.document?.name ?? command.name ?? 'reviewer',
        scope: command.scope ?? command.targetScope ?? 'project',
        destinationPath: REVIEWER.sourcePath,
        contentDigest: 'b'.repeat(64),
      }
    })
  })

  it('lists definitions from every scope and exposes edit actions', async () => {
    render(<AgentDefinitionsCard />)

    expect(await screen.findByText('reviewer')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit reviewer' })).toBeEnabled()
    expect(manageAgentDefinitionsMock).toHaveBeenCalledWith({
      operation: 'list',
      projectPath: PROJECT,
    })
  })

  it('ignores a stale catalog response after the selected project changes', async () => {
    const deferred = Promise.withResolvers<{
      operation: 'list'
      items: readonly AgentDefinitionCatalogItem[]
    }>()
    const otherProject = '/other-project'
    const otherDefinition: AgentDefinitionCatalogItem = {
      ...REVIEWER,
      name: 'implementer',
      sourcePath: `${otherProject}/.openwaggle/agents/implementer.md`,
      definition: { ...REVIEWER_DEFINITION, name: 'implementer' },
    }
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation !== 'list') throw new Error('Unexpected mutation.')
      if (command.projectPath === PROJECT) return deferred.promise
      return { operation: 'list', items: [otherDefinition] }
    })
    render(<AgentDefinitionsCard />)

    await waitFor(() =>
      expect(manageAgentDefinitionsMock).toHaveBeenCalledWith({
        operation: 'list',
        projectPath: PROJECT,
      }),
    )
    act(() => setProject(otherProject))

    expect(await screen.findByText('implementer')).toBeInTheDocument()
    act(() => deferred.resolve({ operation: 'list', items: [REVIEWER] }))
    await waitFor(() => expect(screen.queryByText('reviewer')).not.toBeInTheDocument())
    expect(screen.getByText('implementer')).toBeInTheDocument()
  })

  it('closes project-bound dialogs when the selected project changes', async () => {
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit reviewer' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => setProject('/other-project'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    act(() => setProject(PROJECT))
    await screen.findByRole('button', { name: 'Edit reviewer' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('creates a schema-valid definition without requiring a named role preset', async () => {
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation === 'list') return { operation: 'list', items: [] }
      return {
        operation: 'write',
        name: command.document.name,
        scope: command.scope,
        destinationPath: `/project/${command.document.name}.md`,
      }
    })
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'security-review' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Checks security boundaries.' },
    })
    fireEvent.change(screen.getByLabelText('Markdown instructions'), {
      target: { value: 'Review the authorization boundary.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(manageAgentDefinitionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'write',
          projectPath: PROJECT,
          scope: 'project',
          document: expect.objectContaining({
            name: 'security-review',
            instructions: 'Review the authorization boundary.',
          }),
        }),
      )
    })
  })

  it('preserves explicit empty capability allowlists when editing a definition', async () => {
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation === 'list') {
        return { operation: 'list', items: [LOCKED_DOWN_REVIEWER] }
      }
      return {
        operation: 'write',
        name: command.document.name,
        scope: command.scope,
        destinationPath: LOCKED_DOWN_REVIEWER.sourcePath,
      }
    })
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit locked-down-reviewer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(manageAgentDefinitionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'write',
          projectPath: PROJECT,
          expectedContentDigest: LOCKED_DOWN_REVIEWER.contentDigest,
          document: expect.objectContaining({
            name: 'locked-down-reviewer',
            tools: [],
            skills: [],
            mcpServers: [],
            sessionCapabilities: [],
          }),
        }),
      )
    })
  })

  it('requires reviewing foreign field mappings before import', async () => {
    const sourceDigest = 'c'.repeat(64)
    manageAgentDefinitionsMock.mockImplementation(async (command) => {
      if (command.operation === 'list') return { operation: 'list', items: [] }
      if (command.operation === 'import-plan') {
        return {
          operation: 'import-plan',
          plan: {
            schemaVersion: 1,
            sourceTool: 'claude-code',
            sourcePath: '/imports/reviewer.md',
            sourceDigest,
            targetScope: 'project',
            destinationPath: REVIEWER.sourcePath,
            status: 'ready',
            diagnostics: [],
            fields: [
              {
                sourceField: 'tools',
                disposition: 'dropped',
                detail: 'Foreign capability names require review.',
              },
            ],
            document: REVIEWER.definition,
          },
        }
      }
      return {
        operation: 'import-apply',
        name: 'reviewer',
        scope: 'project',
        destinationPath: REVIEWER.sourcePath,
      }
    })
    render(<AgentDefinitionsCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose source file' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Source file')).toHaveValue('/imports/reviewer.md'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))

    expect(await screen.findByText('Foreign capability names require review.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import' }))
    await waitFor(() => {
      expect(manageAgentDefinitionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'import-apply',
          expectedSourceDigest: sourceDigest,
        }),
      )
    })
  })
})
