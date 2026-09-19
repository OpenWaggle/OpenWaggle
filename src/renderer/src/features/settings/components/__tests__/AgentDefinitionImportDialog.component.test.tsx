import type { AgentDefinitionImportPlan } from '@shared/types/agent-definition-management'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  manageAgentDefinitions: vi.fn(),
  selectAgentDefinitionSource: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

import { AgentDefinitionImportDialog } from '../sections/AgentDefinitionImportDialog'

function importPlan(name: string, sourcePath: string): AgentDefinitionImportPlan {
  return {
    schemaVersion: 1,
    sourceTool: 'openwaggle',
    sourcePath,
    sourceDigest: 'a'.repeat(64),
    targetScope: 'project',
    destinationPath: `/project/.openwaggle/agents/${name}.md`,
    status: 'ready',
    fields: [],
    diagnostics: [],
    document: {
      schemaVersion: 1,
      name,
      description: `${name} description`,
      instructions: `${name} instructions`,
    },
  }
}

describe('AgentDefinitionImportDialog', () => {
  beforeEach(() => vi.resetAllMocks())

  it('does not replace an edited source with a stale file-picker result', async () => {
    const pending = Promise.withResolvers<string>()
    apiMocks.selectAgentDefinitionSource.mockReturnValue(pending.promise)
    render(
      <AgentDefinitionImportDialog
        onClose={vi.fn()}
        onImported={vi.fn().mockResolvedValue(undefined)}
        projectPath="/project"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose source file' }))
    fireEvent.change(screen.getByLabelText('Source file'), {
      target: { value: '/imports/new-choice.md' },
    })
    await act(async () => pending.resolve('/imports/old-choice.md'))

    expect(screen.getByLabelText('Source file')).toHaveValue('/imports/new-choice.md')
  })

  it('does not show a failure from a superseded import plan', async () => {
    const pending = Promise.withResolvers<never>()
    apiMocks.manageAgentDefinitions.mockReturnValue(pending.promise)
    render(
      <AgentDefinitionImportDialog
        onClose={vi.fn()}
        onImported={vi.fn().mockResolvedValue(undefined)}
        projectPath="/project"
      />,
    )

    fireEvent.change(screen.getByLabelText('Source file'), {
      target: { value: '/imports/reviewer.md' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    fireEvent.change(screen.getByLabelText('Source Agent name'), {
      target: { value: 'new-agent' },
    })
    await act(async () => pending.reject(new Error('Stale source failed')))

    expect(screen.queryByText('Stale source failed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled()
  })

  it.each([
    ['source path', 'Source file', '/imports/other.md'],
    ['source format', 'Source format', 'codex'],
    ['source name', 'Source Agent name', 'other-agent'],
    ['destination scope', 'Destination scope', 'user'],
  ])('discards a stale import plan when the %s changes', async (_field, label, value) => {
    const pending = Promise.withResolvers<{
      operation: 'import-plan'
      plan: AgentDefinitionImportPlan
    }>()
    apiMocks.manageAgentDefinitions
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async (command) => ({
        operation: 'import-plan',
        plan: importPlan('fresh-reviewer', command.sourcePath),
      }))
    render(
      <AgentDefinitionImportDialog
        onClose={vi.fn()}
        onImported={vi.fn().mockResolvedValue(undefined)}
        projectPath="/project"
      />,
    )

    fireEvent.change(screen.getByLabelText('Source file'), {
      target: { value: '/imports/reviewer.md' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    await waitFor(() => expect(apiMocks.manageAgentDefinitions).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    await act(async () =>
      pending.resolve({
        operation: 'import-plan',
        plan: importPlan('stale-reviewer', '/imports/reviewer.md'),
      }),
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled())
    expect(screen.queryByText('stale-reviewer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
    await waitFor(() => expect(screen.getByText('fresh-reviewer')).toBeInTheDocument())
    expect(apiMocks.manageAgentDefinitions).toHaveBeenCalledTimes(2)
    expect(apiMocks.manageAgentDefinitions.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        operation: 'import-plan',
        projectPath: '/project',
        sourcePath: label === 'Source file' ? value : '/imports/reviewer.md',
        targetScope: label === 'Destination scope' ? value : 'project',
        ...(label === 'Source format' ? { sourceTool: value } : {}),
        ...(label === 'Source Agent name' ? { sourceName: value } : {}),
      }),
    )
  })
})
