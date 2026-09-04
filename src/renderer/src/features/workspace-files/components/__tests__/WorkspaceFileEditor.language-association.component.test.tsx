import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'

const applyWorkspaceDocumentEditsMock = vi.hoisted(() => vi.fn())
const readWorkspaceFileMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    readWorkspaceFile: readWorkspaceFileMock,
    applyWorkspaceDocumentEdits: applyWorkspaceDocumentEditsMock,
  },
}))

vi.mock('@/shared/ui/FocusedSourceEditor', () => ({
  FocusedSourceEditor: () => null,
}))

const file: WorkspaceTextFileReadResult = {
  path: 'src/example.ts',
  basename: 'example.ts',
  size: 24,
  modifiedAt: 1,
  revision: 'revision-1',
  mimeType: 'text/typescript',
  previewKind: 'text',
  content: 'first line\nsecond line\n',
  language: 'typescript',
  documentVersion: 0,
  fidelity: {
    encoding: 'utf-8',
    lineEnding: 'lf',
    finalNewline: true,
    indentStyle: 'space',
    indentSize: 2,
    editorConfigApplied: false,
  },
}

function WorktreeLanguageHarness() {
  const [projectPath, setProjectPath] = useState('/worktree-a')
  return (
    <>
      <Button
        type="button"
        onClick={() =>
          setProjectPath((current) => (current === '/worktree-a' ? '/worktree-b' : '/worktree-a'))
        }
      >
        Switch worktree
      </Button>
      <WorkspaceFileEditor projectPath={projectPath} file={file} targetLine={null} />
    </>
  )
}

describe('WorkspaceFileEditor language associations', () => {
  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEditsMock.mockReset()
    readWorkspaceFileMock.mockReset()
  })

  it('keeps language overrides scoped to the active worktree', async () => {
    renderWithQueryClient(<WorktreeLanguageHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Python' }))
    expect(screen.getByRole('button', { name: 'Python' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Switch worktree' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'TypeScript' })).toBeVisible())

    fireEvent.click(screen.getByRole('button', { name: 'Switch worktree' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Python' })).toBeVisible())
  })
})
