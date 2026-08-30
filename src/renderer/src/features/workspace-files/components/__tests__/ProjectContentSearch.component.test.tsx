import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  cancelWorkspaceContentSearch: vi.fn(),
  openWorkspaceFile: vi.fn(),
  searchWorkspaceContent: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    cancelWorkspaceContentSearch: mocks.cancelWorkspaceContentSearch,
    searchWorkspaceContent: mocks.searchWorkspaceContent,
  },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => mocks.openWorkspaceFile,
}))

import { ProjectContentSearch } from '../ProjectContentSearch'

describe('ProjectContentSearch query scheduling', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open')
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState((state) => ({
      ...state,
      settings: { ...DEFAULT_SETTINGS, projectPath: '/project' },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('queries only the settled burst and cannot open stale results before the next query settles', async () => {
    vi.useFakeTimers()
    mocks.searchWorkspaceContent.mockImplementation(async (_projectPath: string, query: string) => [
      {
        path: `${query}.ts`,
        basename: `${query}.ts`,
        lineNumber: 1,
        lineText: query,
        matchStart: 0,
        matchLength: query.length,
      },
    ])
    renderWithQueryClient(<ProjectContentSearch />)
    const input = screen.getByRole('textbox', { name: 'Search project contents' })

    fireEvent.change(input, { target: { value: 'o' } })
    fireEvent.change(input, { target: { value: 'ol' } })
    fireEvent.change(input, { target: { value: 'old' } })
    await act(() => vi.advanceTimersByTimeAsync(200))
    await vi.waitFor(() => expect(screen.getByText('old.ts')).toBeInTheDocument())
    expect(screen.getByLabelText('Matching source from old.ts')).toHaveTextContent('old')
    expect(
      screen
        .getByLabelText('Matching source from old.ts')
        .querySelector('[data-syntax-language="typescript"]'),
    ).toBeTruthy()
    expect(mocks.searchWorkspaceContent).toHaveBeenCalledTimes(1)
    expect(mocks.searchWorkspaceContent).toHaveBeenLastCalledWith('/project', 'old', 200)

    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.openWorkspaceFile).not.toHaveBeenCalled()
    expect(screen.queryByText('old.ts')).not.toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(200))
    await vi.waitFor(() => expect(screen.getByText('new.ts')).toBeInTheDocument())
    expect(mocks.searchWorkspaceContent).toHaveBeenCalledTimes(2)
    expect(mocks.searchWorkspaceContent).toHaveBeenLastCalledWith('/project', 'new', 200)
  })

  it('cancels project content work when the query is cleared and when the search closes', () => {
    const view = renderWithQueryClient(<ProjectContentSearch />)
    const input = screen.getByRole('textbox', { name: 'Search project contents' })
    mocks.cancelWorkspaceContentSearch.mockClear()

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(mocks.cancelWorkspaceContentSearch).toHaveBeenCalledWith('/project')
    mocks.cancelWorkspaceContentSearch.mockClear()

    view.unmount()

    expect(mocks.cancelWorkspaceContentSearch).toHaveBeenCalledWith('/project')
  })

  it('keeps offscreen result snippets plain until they approach the viewport', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect() {}
        observe() {}
      },
    )
    mocks.searchWorkspaceContent.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) => ({
        path: `src/result-${String(index)}.ts`,
        basename: `result-${String(index)}.ts`,
        lineNumber: index + 1,
        lineText: `const result${String(index)} = true`,
        matchStart: 6,
        matchLength: 6,
      })),
    )
    const { container } = renderWithQueryClient(<ProjectContentSearch />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search project contents' }), {
      target: { value: 'result' },
    })
    await act(() => vi.advanceTimersByTimeAsync(200))
    await vi.waitFor(() => expect(screen.getByText('src/result-199.ts')).toBeInTheDocument())

    expect(container.querySelectorAll('[data-syntax-language]')).toHaveLength(0)
    expect(screen.getAllByText(/const result\d+ = true/u)).toHaveLength(200)
  })
})
