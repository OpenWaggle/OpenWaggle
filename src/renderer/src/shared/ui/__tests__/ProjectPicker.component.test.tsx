import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectPicker } from '../ProjectPicker'

describe('ProjectPicker', () => {
  it('includes paths in accessible names when projects share a display name', () => {
    render(
      <ProjectPicker
        resourceName="Agents"
        projects={['/workspace/a/app', '/workspace/b/app']}
        selectedProject="/workspace/a/app"
        displayNames={{}}
        onSelect={vi.fn()}
        onOpenFolder={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Project: app' }))

    expect(screen.getByRole('button', { name: 'app (/workspace/a/app)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app (/workspace/b/app)' })).toBeInTheDocument()
  })

  it('loads older Session projects through indexed pages', async () => {
    const loadProjectsPage = vi
      .fn()
      .mockResolvedValueOnce({ paths: ['/workspace/older'], nextCursor: '/workspace/older' })
      .mockResolvedValueOnce({ paths: ['/workspace/oldest'] })
    const onSelect = vi.fn()
    render(
      <ProjectPicker
        resourceName="Skills"
        projects={['/workspace/current']}
        selectedProject="/workspace/current"
        displayNames={{}}
        onSelect={onSelect}
        onOpenFolder={vi.fn()}
        loadProjectsPage={loadProjectsPage}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Project: current' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'older (/workspace/older)' })).toBeInTheDocument(),
    )
    const loadMore = screen.getByRole('button', { name: 'Load more projects' })
    loadMore.focus()
    fireEvent.click(loadMore)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'oldest (/workspace/oldest)' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'All projects loaded' })).toBe(loadMore)
    expect(document.activeElement).toBe(loadMore)
    fireEvent.click(screen.getByRole('button', { name: 'oldest (/workspace/oldest)' }))
    expect(onSelect).toHaveBeenCalledWith('/workspace/oldest')
    expect(loadProjectsPage).toHaveBeenNthCalledWith(2, '/workspace/older', '')
  })

  it('searches the Host catalog beyond the first loaded page', async () => {
    const loadProjectsPage = vi.fn(async (_cursor?: string, search?: string) => ({
      paths: search === 'remote' ? ['/workspace/remote-project'] : [],
    }))
    render(
      <ProjectPicker
        resourceName="Agents"
        projects={['/workspace/current']}
        selectedProject="/workspace/current"
        displayNames={{}}
        onSelect={vi.fn()}
        onOpenFolder={vi.fn()}
        loadProjectsPage={loadProjectsPage}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Project: current' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'remote' },
    })
    expect(
      await screen.findByRole('button', { name: 'remote-project (/workspace/remote-project)' }),
    ).toBeInTheDocument()
    expect(loadProjectsPage).toHaveBeenLastCalledWith(undefined, 'remote')
  })

  it('keeps a catalog-only selection visible when reopening the first page', async () => {
    const loadProjectsPage = vi
      .fn()
      .mockResolvedValueOnce({ paths: ['/workspace/older'] })
      .mockResolvedValueOnce({ paths: [] })
    const onSelect = vi.fn()
    const props = {
      resourceName: 'Agents',
      projects: ['/workspace/current'],
      selectedProject: '/workspace/current',
      displayNames: {},
      onSelect,
      onOpenFolder: vi.fn(),
      loadProjectsPage,
    }
    const view = render(<ProjectPicker {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Project: current' }))
    fireEvent.click(await screen.findByRole('button', { name: 'older (/workspace/older)' }))
    view.rerender(<ProjectPicker {...props} selectedProject="/workspace/older" />)
    fireEvent.click(screen.getByRole('button', { name: 'Project: older' }))

    expect(screen.getByRole('button', { name: 'older (/workspace/older)' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('renders a decomposed Unicode project returned by Host search', async () => {
    const projectPath = '/workspace/cafe\u0301'
    const loadProjectsPage = vi.fn(async (_cursor?: string, search?: string) => ({
      paths: search === 'café' ? [projectPath] : [],
    }))
    render(
      <ProjectPicker
        resourceName="Skills"
        projects={[]}
        selectedProject={null}
        displayNames={{}}
        onSelect={vi.fn()}
        onOpenFolder={vi.fn()}
        loadProjectsPage={loadProjectsPage}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Project: Choose project' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'café' },
    })
    expect(
      await screen.findByRole('button', { name: `cafe\u0301 (${projectPath})` }),
    ).toBeInTheDocument()
  })
})
