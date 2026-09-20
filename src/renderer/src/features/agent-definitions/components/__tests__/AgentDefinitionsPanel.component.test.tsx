import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentDefinitionsPanel } from '../AgentDefinitionsPanel'

const state = vi.hoisted(() => ({
  toggleAgent: vi.fn(),
  selectAgent: vi.fn(),
  items: [
    {
      name: 'reviewer',
      description: 'Reviews changes',
      scope: 'portable-project' as const,
      sourcePath: '/tmp/project/.agents/agents/reviewer.md',
      enabled: true,
    },
  ],
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: '/tmp/project' }),
}))

vi.mock('../../hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: () => ({
    items: state.items,
    selectedName: 'reviewer',
    selectAgent: state.selectAgent,
    toggleAgent: state.toggleAgent,
    previewMarkdown:
      '---\nname: reviewer\ndescription: Reviews changes\n---\n\n# Review instructions',
    isLoading: false,
    isPreviewLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

describe('Agents read-only browser', () => {
  it('shows Markdown frontmatter and instructions without editing controls', () => {
    render(<AgentDefinitionsPanel />)

    expect(screen.getByRole('region', { name: 'Agent frontmatter' })).toHaveTextContent(
      'name: reviewer',
    )
    expect(screen.getByRole('heading', { name: 'Review instructions' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Disable reviewer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|import|delete/i })).not.toBeInTheDocument()
  })

  it('can disable a definition for future Sessions', () => {
    render(<AgentDefinitionsPanel />)
    fireEvent.click(screen.getByRole('switch', { name: 'Disable reviewer' }))
    expect(state.toggleAgent).toHaveBeenCalledWith('reviewer', false)
  })
})
