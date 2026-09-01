import type {
  WorkspaceFilePage,
  WorkspaceFileReadResult,
  WorkspaceTextFileReadResult,
  WorkspaceUnavailableFileReadResult,
} from '@shared/types/workspace-files'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/queries/query-keys'
import { Button } from '@/shared/ui/Button'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFilePane } from '../WorkspaceFilePreview'

const ipcMocks = vi.hoisted(() => ({
  readWorkspaceFile: vi.fn(),
  readWorkspaceFilePage: vi.fn(),
}))
const editorMounts = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/shared/lib/ipc', () => ({ api: ipcMocks }))
vi.mock('@/shared/ui/SourceView', () => ({
  SourceView: ({ source }: { readonly source: string }) => <pre>{source}</pre>,
}))
vi.mock('../WorkspaceFileEditor', async () => {
  const { useState: useMockState } = await import('react')
  return {
    WorkspaceFileEditor: ({ projectPath }: { readonly projectPath: string }) => {
      const [mountId] = useMockState(() => {
        editorMounts.count += 1
        return editorMounts.count
      })
      return <output data-testid="editor-instance">{`${projectPath}:${String(mountId)}`}</output>
    },
  }
})

const SHARED_PATH = 'src/shared.ts'

function textFile(projectPath: string): WorkspaceTextFileReadResult {
  return {
    path: SHARED_PATH,
    basename: 'shared.ts',
    size: 10,
    modifiedAt: 1,
    revision: 'same-revision',
    mimeType: 'text/typescript',
    previewKind: 'text',
    content: projectPath,
    language: 'typescript',
    documentVersion: 0,
    fidelity: {
      encoding: 'utf-8',
      lineEnding: 'none',
      finalNewline: false,
      indentStyle: 'space',
      indentSize: 2,
      editorConfigApplied: false,
    },
  }
}

const oversizedFile: WorkspaceUnavailableFileReadResult = {
  path: SHARED_PATH,
  basename: 'shared.ts',
  size: 2_000_000,
  modifiedAt: 1,
  revision: 'same-revision',
  mimeType: 'text/typescript',
  previewKind: 'oversized',
  reason: 'Large source file',
  language: 'typescript',
}

function page(content: string, offset: number, nextOffset: number | null): WorkspaceFilePage {
  return {
    path: SHARED_PATH,
    size: 2_000_000,
    offset,
    endOffset: offset + content.length,
    nextOffset,
    content,
    encoding: 'utf-8',
    language: 'typescript',
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function ProjectSwitchHarness() {
  const [projectPath, setProjectPath] = useState('/worktree-a')
  return (
    <>
      <Button onClick={() => setProjectPath('/worktree-b')}>Switch worktree</Button>
      <WorkspaceFilePane projectPath={projectPath} relativePath={SHARED_PATH} line={null} />
    </>
  )
}

describe('WorkspaceFilePane file identity', () => {
  beforeEach(() => {
    ipcMocks.readWorkspaceFile.mockReset()
    ipcMocks.readWorkspaceFilePage.mockReset()
    editorMounts.count = 0
  })

  it('recreates the editor queue when the worktree root changes', async () => {
    ipcMocks.readWorkspaceFile.mockImplementation(async (projectPath: string) =>
      textFile(projectPath),
    )
    renderWithQueryClient(<ProjectSwitchHarness />)

    expect(await screen.findByTestId('editor-instance')).toHaveTextContent('/worktree-a:1')
    fireEvent.click(screen.getByRole('button', { name: 'Switch worktree' }))
    await waitFor(() =>
      expect(screen.getByTestId('editor-instance')).toHaveTextContent('/worktree-b:2'),
    )
  })

  it('ignores an old manual page read after switching worktrees', async () => {
    const oldNextPage = deferred<WorkspaceFilePage>()
    const newInitialPage = deferred<WorkspaceFilePage>()
    ipcMocks.readWorkspaceFile.mockResolvedValue(oversizedFile satisfies WorkspaceFileReadResult)
    ipcMocks.readWorkspaceFilePage.mockImplementation(
      (projectPath: string, _path: string, offset: number) => {
        if (projectPath === '/worktree-a' && offset === 0) {
          return Promise.resolve(page('worktree A first page', 0, 100))
        }
        if (projectPath === '/worktree-a') return oldNextPage.promise
        return newInitialPage.promise
      },
    )
    renderWithQueryClient(<ProjectSwitchHarness />)

    expect(await screen.findByText('worktree A first page')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(ipcMocks.readWorkspaceFilePage).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Switch worktree' }))
    await act(async () => newInitialPage.resolve(page('worktree B first page', 0, null)))
    expect(await screen.findByText('worktree B first page')).toBeVisible()

    await act(async () => oldNextPage.resolve(page('stale worktree A page', 100, null)))
    expect(screen.getByText('worktree B first page')).toBeVisible()
    expect(screen.queryByText('stale worktree A page')).not.toBeInTheDocument()
  })

  it('reloads an oversized preview when the file revision changes in place', async () => {
    ipcMocks.readWorkspaceFile.mockResolvedValue(oversizedFile satisfies WorkspaceFileReadResult)
    ipcMocks.readWorkspaceFilePage
      .mockResolvedValueOnce(page('old revision page', 0, null))
      .mockResolvedValueOnce(page('new revision page', 0, null))
    const { client } = renderWithQueryClient(
      <WorkspaceFilePane projectPath="/worktree-a" relativePath={SHARED_PATH} line={null} />,
    )

    expect(await screen.findByText('old revision page')).toBeVisible()
    act(() => {
      client.setQueryData(queryKeys.workspaceFile('/worktree-a', SHARED_PATH), {
        ...oversizedFile,
        revision: 'new-revision',
      } satisfies WorkspaceFileReadResult)
    })

    expect(await screen.findByText('new revision page')).toBeVisible()
    expect(screen.queryByText('old revision page')).not.toBeInTheDocument()
    expect(ipcMocks.readWorkspaceFilePage).toHaveBeenCalledTimes(2)
  })
})
